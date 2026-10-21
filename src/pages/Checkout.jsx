import React, { useEffect, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { fetchProductById } from "../lib/shopApi";
import { startCheckout, submitSlip, prepareSlipImage, rememberOrder, readStoredCharge, storeCharge, clearStoredCharge } from "../lib/checkout";
import PaymentMethods from "../components/PaymentMethods";
import PayHelp from "../components/PayHelp";
import "../css/Checkout.css";

function formatTHB(satang) {
  return (Number(satang) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function useCountdown(expiresAt) {
  const [left, setLeft] = useState(null);
  useEffect(() => {
    if (!expiresAt) return undefined;
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

const SLIP_ACCEPT = "image/png,image/jpeg,image/webp,image/jfif";
const SLIP_EXT_RE = /\.(png|jpe?g|webp|jfif)$/i;

// Browsers sometimes report an empty type for .jfif files, so fall back to the
// file extension before rejecting a dropped slip.
function isSlipFile(file) {
  if (!file) return false;
  return SLIP_ACCEPT.split(",").includes(file.type) || SLIP_EXT_RE.test(file.name || "");
}

// The charge (order + QR image) only lives in React state, so a refresh would
// silently drop the order and strand a buyer who already paid. The helpers in
// lib/checkout keep it in localStorage for the QR lifetime plus grace, so a
// buyer can leave the site and come back to the same QR / slip upload.

function Checkout() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [email, setEmail] = useState("");
  const [charge, setCharge] = useState(() => readStoredCharge(id).charge); // { orderId, qr, amount, expiresAt }
  const [slipFile, setSlipFile] = useState(null);
  const [slipInfo, setSlipInfo] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const expiredStored = useRef(false);
  const fileInputRef = useRef(null);

  const secondsLeft = useCountdown(charge?.expiresAt);
  const qrExpired =
    Boolean(charge?.expiresAt) &&
    (secondsLeft === 0 || new Date(charge.expiresAt).getTime() <= Date.now());

  useEffect(() => {
    fetchProductById(id).then((p) => setProduct(p || null)).catch(() => {});
  }, [id]);

  // Restore the charge for this product. Only redirect once the server's
  // resume/grace window is over; an expired QR countdown is still usable for
  // buyers who already transferred the money.
  useEffect(() => {
    const stored = readStoredCharge(id);
    if (stored.expired) {
      expiredStored.current = true;
      clearStoredCharge();
      navigate(`/product/${id}`, { replace: true });
      return;
    }
    expiredStored.current = false;
    setCharge(stored.charge);
    if (stored.charge) {
      rememberOrder({
        orderId: stored.charge.orderId,
        accessToken: stored.charge.accessToken,
        productId: id,
      });
    }
  }, [id, navigate]);

  // Dev-only shortcut: /checkout/prod1?preview=qr jumps straight to the QR
  // screen without filling the form (uses the mock API from setupProxy.js).
  // An existing charge is reused so a refresh keeps the same QR and countdown.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (new URLSearchParams(window.location.search).get("preview") !== "qr") return;
    if (expiredStored.current) return; // expired reload → redirect handled above
    if (readStoredCharge(id).charge) return;
    startCheckout(id, "demo@example.com")
      .then((res) => {
        setCharge(res);
        storeCharge(id, res);
        rememberOrder({ orderId: res.orderId, accessToken: res.accessToken, productId: id });
      })
      .catch(() => {});
  }, [id]);

  const createQr = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const res = await startCheckout(id, email);
      setCharge(res);
      storeCharge(id, res);
      rememberOrder({ orderId: res.orderId, accessToken: res.accessToken, productId: id });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // The QR is gone for good, so drop the stored order and let the buyer
  // generate a fresh one. Leaving via "Back to product" keeps the charge so
  // the floating checkout button can still resume it.
  const startNewCheckout = () => {
    clearStoredCharge();
    setCharge(null);
    setSlipFile(null);
    setSlipInfo("");
    setError("");
    setNotice("");
  };

  const chooseSlip = (file) => {
    if (file && !isSlipFile(file)) {
      setSlipFile(null);
      setSlipInfo("");
      setError("Please choose an image file (PNG, JPG, WEBP or JFIF).");
      return;
    }
    setSlipFile(file || null);
    setSlipInfo("");
    setError("");
    setNotice("");
  };

  const onSlipDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };

  const onSlipDragLeave = (e) => {
    // Ignore the leave events fired while moving over child elements.
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragging(false);
  };

  const onSlipDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    chooseSlip(e.dataTransfer.files && e.dataTransfer.files[0]);
  };

  const sendSlip = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!slipFile || !charge) return;
    setBusy(true);
    try {
      // Downscale in the browser so the upload stays under Vercel's body limit.
      setNotice("Preparing your slip…");
      const prepared = await prepareSlipImage(slipFile);
      setSlipInfo(`Ready to send — ${Math.max(1, Math.round(prepared.bytes / 1024))} KB`);
      setNotice("");
      const res = await submitSlip(charge.orderId, charge.accessToken, {
        imageBase64: prepared.imageBase64,
        imageMime: prepared.imageMime,
      });
      if (res.status === "paid") {
        clearStoredCharge();
        const emailFlag = res.emailSent === false ? "&email=0" : "";
        navigate(
          `/success?orderId=${encodeURIComponent(charge.orderId)}` +
            `&token=${encodeURIComponent(charge.accessToken)}${emailFlag}`,
        );
        return;
      }
      setNotice(res.message || "Verification failed. Please try again or contact the shop.");
    } catch (err) {
      setSlipInfo("");
      if (err.status === 413) {
        setError(err.message);
      } else if (err.status === 429) {
        setNotice(err.message || "Too many attempts. Please wait a moment and try again.");
      } else if (err.data && err.data.status === "expired") {
        setError(err.data.message || "This payment window has closed. Please contact the shop.");
      } else if (err.data && err.data.status === "rejected") {
        setError(err.data.message || "The slip did not pass verification.");
      } else if (err.data && err.data.retryable) {
        setNotice(err.data.message || "Please wait a moment and try again.");
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="Checkout">
      {product?.image && (
        <img
          className="checkout-image"
          src={product.image}
          alt={product.name || "Product"}
        />
      )}
      <h1>Checkout</h1>
      {product && (
        <p className="checkout-product">
          {product.name} — <strong>{product.price.toLocaleString()} {product.currency}</strong>
        </p>
      )}

      {!charge ? (
        <form className="checkout-card" onSubmit={createQr}>
          <label htmlFor="email">Email to receive your download link</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <PaymentMethods />
          <button type="submit" disabled={busy}>
            {busy ? "Creating QR…" : "Generate PromptPay QR"}
          </button>
          {error && <p className="checkout-error">{error}</p>}
          <PayHelp />
        </form>
      ) : (
        <div className="checkout-card">
          {qrExpired ? (
            <div className="checkout-expired" role="status">
              <span className="checkout-expired-face" aria-hidden="true">:(</span>
              <p className="checkout-expired-title">QR code expired</p>
              <p className="checkout-expired-text">
                This QR is no longer valid. If you already paid, upload your slip below.
                Otherwise start a new checkout.
              </p>
              <button type="button" className="checkout-new-button" onClick={startNewCheckout}>
                Start a new checkout
              </button>
            </div>
          ) : (
            <>
              <p className="checkout-step">Scan and pay with your banking app</p>
              <img className="checkout-qr" src={charge.qr} alt="PromptPay QR" />
              <p className="checkout-amount">{formatTHB(charge.amount)} {charge.currency}</p>
              {secondsLeft != null && secondsLeft > 0 && (
                <p className="checkout-timer">
                  QR expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
                </p>
              )}
            </>
          )}

          <hr />
          <p className="checkout-step">Already paid? Upload your slip to get your product instantly</p>
          <form onSubmit={sendSlip}>
            <div
              className={`checkout-dropzone${dragging ? " is-dragging" : ""}`}
              onDragOver={onSlipDragOver}
              onDragEnter={onSlipDragOver}
              onDragLeave={onSlipDragLeave}
              onDrop={onSlipDrop}
            >
              <svg
                className="checkout-dropzone-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
                <polyline points="16 16 12 12 8 16" />
                <line x1="12" y1="12" x2="12" y2="21" />
              </svg>
              <p className="checkout-dropzone-text">
                Drag &amp; drop your slip here, or choose a file below
              </p>
              <input
                ref={fileInputRef}
                className="checkout-file-input"
                type="file"
                accept={SLIP_ACCEPT}
                onChange={(e) => {
                  chooseSlip(e.target.files?.[0]);
                  // Reset so picking the same file again still fires onChange.
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="checkout-file-button"
                onClick={() => fileInputRef.current?.click()}
              >
                {slipFile ? slipFile.name : "Choose file"}
              </button>
            </div>
            {slipFile && <p className="checkout-hint">Selected: {slipFile.name}</p>}
            <p className="checkout-hint">
              Use the slip from your banking app. E-wallet slips (e.g. TrueMoney) cannot be
              verified automatically — contact us if that is all you have.
            </p>
            {slipInfo && <p className="checkout-hint">{slipInfo}</p>}
            <button type="submit" disabled={busy || !slipFile}>
              {busy ? "Verifying slip…" : "Confirm payment"}
            </button>
          </form>
          {error && <p className="checkout-error">{error}</p>}
          {notice && <p className="checkout-notice">{notice}</p>}

          <PayHelp />
        </div>
      )}

      <p className="checkout-back">
        {/* Going back must NOT clear the stored charge: the floating checkout
            button uses it to bring the buyer back to this same QR / slip
            upload. Use “Start a new checkout” when a fresh order is wanted. */}
        <Link to={`/product/${id}`}>← Back to product</Link>
      </p>
    </div>
  );
}

export default Checkout;

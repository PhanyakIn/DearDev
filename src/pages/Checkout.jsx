import React, { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { fetchProductById } from "../lib/shopApi";
import { startCheckout, submitSlip, prepareSlipImage } from "../lib/checkout";
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

function Checkout() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [email, setEmail] = useState("");
  const [charge, setCharge] = useState(null); // { orderId, qr, amount, expiresAt }
  const [slipFile, setSlipFile] = useState(null);
  const [slipInfo, setSlipInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const secondsLeft = useCountdown(charge?.expiresAt);

  useEffect(() => {
    fetchProductById(id).then((p) => setProduct(p || null)).catch(() => {});
  }, [id]);

  const createQr = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const res = await startCheckout(id, email);
      setCharge(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
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
      const res = await submitSlip(charge.orderId, {
        imageBase64: prepared.imageBase64,
        imageMime: prepared.imageMime,
      });
      if (res.status === "paid") {
        navigate(`/success?orderId=${encodeURIComponent(charge.orderId)}`);
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
          <p className="checkout-step">Scan and pay with your banking app</p>
          <img className="checkout-qr" src={charge.qr} alt="PromptPay QR" />
          <p className="checkout-amount">{formatTHB(charge.amount)} {charge.currency}</p>
          {secondsLeft != null && (
            <p className={`checkout-timer${secondsLeft === 0 ? " expired" : ""}`}>
              {secondsLeft > 0
                ? `QR expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`
                : "QR expired — if you already paid, upload your slip below; otherwise go back and generate a new QR"}
            </p>
          )}

          <PayHelp />

          <hr />
          <p className="checkout-step">Already paid? Upload your slip to get your product instantly</p>
          <form onSubmit={sendSlip}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/jfif"
              onChange={(e) => {
                setSlipFile(e.target.files?.[0] || null);
                setSlipInfo("");
                setError("");
                setNotice("");
              }}
            />
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

          <button
            type="button"
            className="checkout-reset"
            onClick={() => {
              setCharge(null);
              setSlipFile(null);
              setSlipInfo("");
              setNotice("");
              setError("");
            }}
          >
            Start over
          </button>
        </div>
      )}

      <p className="checkout-back">
        <Link to={`/product/${id}`}>← Back to product</Link>
      </p>
    </div>
  );
}

export default Checkout;

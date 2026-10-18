import React, { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { fetchProductById } from "../lib/shopApi";
import { startCheckout, submitSlip, fileToBase64 } from "../lib/checkout";
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
      const imageBase64 = await fileToBase64(slipFile);
      const res = await submitSlip(charge.orderId, {
        imageBase64,
        imageMime: slipFile.type || "image/jpeg",
      });
      if (res.status === "paid") {
        navigate(`/success?orderId=${encodeURIComponent(charge.orderId)}`);
        return;
      }
      setNotice(res.message || "Verification failed. Please try again or contact the shop.");
    } catch (err) {
      if (err.data && err.data.status === "rejected") {
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
          <button type="submit" disabled={busy}>
            {busy ? "Creating QR…" : "Generate PromptPay QR"}
          </button>
          {error && <p className="checkout-error">{error}</p>}
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
                : "QR expired — please generate a new one"}
            </p>
          )}

          <hr />
          <p className="checkout-step">Already paid? Upload your slip to get your product instantly</p>
          <form onSubmit={sendSlip}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/jfif"
              onChange={(e) => setSlipFile(e.target.files?.[0] || null)}
            />
            <button type="submit" disabled={busy || !slipFile || secondsLeft === 0}>
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

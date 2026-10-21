import React, { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getCheckoutResumeTarget } from "../lib/checkout";
import "../css/FloatingCheckout.css";

// A persistent shortcut back to the buyer's active QR/slip screen. It is
// hidden on checkout and success, where the same content is already on screen.
function FloatingCheckout() {
  const location = useLocation();
  const [target, setTarget] = useState(() => getCheckoutResumeTarget());

  const refresh = useCallback(() => {
    setTarget(getCheckoutResumeTarget());
  }, []);

  // Re-read after navigation or when another tab/checkout updates storage.
  useEffect(() => {
    refresh();
  }, [location.pathname, refresh]);

  useEffect(() => {
    const onStorage = (event) => {
      if (!event.key || event.key.indexOf("dearcheckout:") === 0) refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const hidden =
    location.pathname.startsWith("/checkout") ||
    location.pathname.startsWith("/success");
  if (hidden) return null;

  let to = "/catalog";
  if (target.type === "checkout") {
    to = `/checkout/${encodeURIComponent(target.productId)}`;
  } else if (target.type === "order") {
    to =
      `/success?orderId=${encodeURIComponent(target.orderId)}` +
      `&token=${encodeURIComponent(target.accessToken)}`;
  }

  const hasActiveCharge = target.type === "checkout";
  const label = hasActiveCharge
    ? "กลับไปหน้าจ่ายเงิน (มีรายการที่ยังไม่เสร็จ)"
    : "กลับไปหน้าจ่ายเงิน";

  return (
    <Link
      to={to}
      className="floating-checkout"
      aria-label={label}
    >
      {hasActiveCharge && (
        <span className="floating-checkout-badge" aria-hidden="true" />
      )}
      <span className="floating-checkout-tooltip" aria-hidden="true">
        กลับไปหน้าจ่ายเงิน
      </span>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" />
        <path d="M9 7h6" />
        <path d="M9 11h6" />
        <path d="M9 15h4" />
      </svg>
    </Link>
  );
}

export default FloatingCheckout;

import React from "react";
import { Link } from "react-router-dom";
import { readLastOrder } from "../lib/checkout";
import "../css/Success.css";

// A small safety net for buyers who close the success tab. Email delivery is
// optional, so the order link is the only proof of purchase; we remember the
// most recent order in this browser (token included) for 30 days.
function Recover() {
  const last = readLastOrder();

  return (
    <div className="Success">
      <h1>Recover your order</h1>
      {last ? (
        <div className="success-card">
          <p>We found your most recent order on this browser.</p>
          <Link
            className="success-download"
            to={
              `/success?orderId=${encodeURIComponent(last.orderId)}` +
              `&token=${encodeURIComponent(last.accessToken)}`
            }
          >
            Open my order
          </Link>
          <p className="success-hint">
            This only works in the browser where you checked out. On another device, contact the shop with
            your order ID and payment time.
          </p>
        </div>
      ) : (
        <div className="success-card">
          <p>No recent order was found in this browser.</p>
          <p>
            If you have already paid, contact the shop with the email address you used and the approximate
            payment time.
          </p>
          <Link to="/contact">Contact the shop</Link>
        </div>
      )}
      <p className="success-back">
        <Link to="/catalog">← Back to store</Link>
      </p>
    </div>
  );
}

export default Recover;

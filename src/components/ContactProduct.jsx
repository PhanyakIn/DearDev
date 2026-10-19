import React from "react";
import { Link } from "react-router-dom";
import PaymentMethods from "./PaymentMethods";
import "../css/ContactProduct.css";

function ContactProduct({ productId }) {
  return (
    <div className="product-payment">
      <h2>Interested? Get in touch</h2>
      <p>Pay with PromptPay and get your files instantly and automatically.</p>

      <PaymentMethods />

      <p className="product-payment-alt">
        Only have TrueMoney or another e-wallet?{" "}
        <Link to="/contact">Contact me</Link> for a manual payment.
      </p>

      <div className="product-contact-btns">
        <Link className="contact-btn contact-buy" to={`/checkout/${productId}`}>
          Buy now — Pay with PromptPay
        </Link>
      </div>
    </div>
  );
}

export default ContactProduct;

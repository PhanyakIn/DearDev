import React from "react";
import { Link } from "react-router-dom";
import "../css/ContactProduct.css";

import promptpayLogo from "../images/banks/promptpay.png";
import kbankLogo from "../images/banks/kbank.svg";
import scbLogo from "../images/banks/scb.svg";
import bblLogo from "../images/banks/bbl.svg";
import krungsriLogo from "../images/banks/krungsri.svg";
import krungthaiLogo from "../images/banks/krungthai.svg";
import gsbLogo from "../images/banks/gsb.svg";
import baacLogo from "../images/banks/baac.svg";
import uobLogo from "../images/banks/uob.svg";
import ttbLogo from "../images/banks/ttb.svg";

const supportedBanks = [
  { src: kbankLogo, alt: "Kasikornbank (KBank)", color: "#138f2d" },
  { src: scbLogo, alt: "SCB", color: "#4e2e7f" },
  { src: bblLogo, alt: "Bangkok Bank", color: "#1e4598" },
  { src: krungsriLogo, alt: "Bank of Ayudhya (Krungsri)", color: "#fec43b" },
  { src: krungthaiLogo, alt: "Krungthai Bank", color: "#1ba5e1" },
  { src: gsbLogo, alt: "Government Savings Bank (GSB)", color: "#eb198d" },
  { src: baacLogo, alt: "BAAC", color: "#4b9b1d" },
  { src: uobLogo, alt: "UOB", color: "#0b3979" },
{ src: ttbLogo, alt: "ttb", color: "#FF5000" },
];

function ContactProduct({ productId }) {
  return (
    <div className="product-payment">
      <h2>Interested? Get in touch</h2>
      <p>Pay with PromptPay and get your files instantly and automatically.</p>

      <div className="product-payment-methods">
        <img className="payment-method-promptpay" src={promptpayLogo} alt="PromptPay" />
        <ul className="payment-method-banks">
          {supportedBanks.map((bank) => (
            <li key={bank.alt} style={{ backgroundColor: bank.color }} title={bank.alt}>
              <img src={bank.src} alt={`${bank.alt} logo`} />
            </li>
          ))}
        </ul>
        <p className="payment-method-note">
          Scan with any Thai banking app — slips are verified automatically via SlipOK.
        </p>
      </div>

      <div className="product-contact-btns">
        <Link className="contact-btn contact-buy" to={`/checkout/${productId}`}>
          Buy now — Pay with PromptPay
        </Link>
      </div>
    </div>
  );
}

export default ContactProduct;

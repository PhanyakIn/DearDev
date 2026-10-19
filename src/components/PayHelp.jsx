import React from "react";
import { Link } from "react-router-dom";
import { useContact } from "../lib/useShop";
import "../css/PayHelp.css";

// The contact columns are seeded with placeholders until they are replaced.
function usable(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

// E-wallet slips (TrueMoney, etc.) have no QR to recheck, so our automatic
// verification cannot handle them. This routes those buyers to the owner
// instead of letting them pay and then get stuck.
function PayHelp() {
  const contact = useContact();
  const discord = usable(contact.discord) ? contact.discord.trim() : "";
  const facebook = usable(contact.facebook) ? contact.facebook.trim() : "";

  return (
    <div className="pay-help">
      <p className="pay-help-title">Paying with TrueMoney or another e-wallet?</p>
      <p className="pay-help-text">
        E-wallet slips can&apos;t be verified automatically. Message me and I&apos;ll
        arrange a manual payment for you.
      </p>
      <div className="pay-help-links">
        {discord && (
          <a
            className="pay-help-link"
            href={discord}
            target="_blank"
            rel="noopener noreferrer"
          >
            Message on Discord
          </a>
        )}
        {facebook && (
          <a
            className="pay-help-link"
            href={facebook}
            target="_blank"
            rel="noopener noreferrer"
          >
            Message on Facebook
          </a>
        )}
        {!discord && !facebook && (
          <Link className="pay-help-link" to="/contact">
            Go to Contact
          </Link>
        )}
      </div>
    </div>
  );
}

export default PayHelp;

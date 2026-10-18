import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchOrder, downloadUrl } from "../lib/checkout";
import "../css/Success.css";

function Success() {
  const [params] = useSearchParams();
  const orderId = params.get("orderId") || "";
  const [order, setOrder] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | missing | error
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    if (!orderId) {
      setStatus("missing");
      return;
    }
    fetchOrder(orderId)
      .then((data) => {
        setOrder(data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const copyKey = async () => {
    if (!order?.licenseKey) return;
    try {
      await navigator.clipboard.writeText(order.licenseKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (status === "loading") return <div className="Success"><p>กำลังโหลด…</p></div>;
  if (status === "missing") return <div className="Success"><p>ไม่พบเลขออเดอร์</p><Link to="/catalog">กลับร้านค้า</Link></div>;
  if (status === "error") return <div className="Success"><p>โหลดข้อมูลออเดอร์ไม่สำเร็จ</p><Link to="/catalog">กลับร้านค้า</Link></div>;

  const paid = order.status === "paid";

  return (
    <div className="Success">
      <h1>{paid ? "ชำระเงินสำเร็จ 🎉" : "สถานะออเดอร์"}</h1>
      {order.productName && <p className="success-product">{order.productName}</p>}

      {!paid ? (
        <div className="success-card">
          <p>
            สถานะ: <strong>{order.status}</strong>
          </p>
          <p>หากชำระเงินแล้วแต่ยังไม่ได้รับสินค้า กรุณาติดต่อร้านพร้อมสลิป</p>
        </div>
      ) : (
        <div className="success-card">
          <p className="success-label">License key</p>
          <div className="success-key">
            <code>{order.licenseKey}</code>
            <button type="button" onClick={copyKey}>{copied ? "คัดลอกแล้ว" : "คัดลอก"}</button>
          </div>

          <p className="success-download-note">
            ดาวน์โหลดได้อีก <strong>{order.remaining}</strong> / {order.downloadLimit} ครั้ง
          </p>
          {order.remaining > 0 ? (
            <a
              className="success-download"
              href={downloadUrl(orderId)}
              target="_blank"
              rel="noreferrer"
              onClick={() => setTimeout(load, 1500)}
            >
              ดาวน์โหลดสินค้า
            </a>
          ) : (
            <span className="success-download disabled">ครบจำนวนดาวน์โหลดแล้ว</span>
          )}
          <p className="success-hint">ลิงก์นี้ถูกส่งไปที่อีเมลของคุณแล้วด้วย</p>
        </div>
      )}

      <p className="success-back">
        <Link to="/catalog">← กลับร้านค้า</Link>
      </p>
    </div>
  );
}

export default Success;

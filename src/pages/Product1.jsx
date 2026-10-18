import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchProductById } from "../lib/shopApi";
import ProductVideo from "../data/ProductVideo";
import ContactProduct from "../components/ContactProduct";
import "../css/Product1.css";

function Product1() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProductById(id || "prod1")
      .then((p) => setProduct(p || null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="Product1">
        <p>Loading product…</p>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="Product1">
        <p>No products found</p>
        <Link to="/catalog">Back to Catalog</Link>
      </div>
    );
  }

  return (
    <div className="Product1">
      <div className="product1-layout">
        <div className="product1-media">
          <div className="product1-image-wrap">
            {product.badge && <span className="product1-badge">{product.badge}</span>}
            <img src={product.image} alt={product.name} className="product1-image" />
          </div>
          {product.videoUrl && (
            <ProductVideo
              videoUrl={product.videoUrl}
              title={`${product.name} video`}
              autoplay
            />
          )}
        </div>
        <div className="product1-info">
          <h1 className="product1-name">{product.name}</h1>
          <p className="product1-price">
            Price <span>{product.price.toLocaleString()}</span>{product.currency}
          </p>
          <p className="product1-short">{product.shortDetail}</p>
          <hr />
          <h2>Product Details</h2>
          <p className="product1-desc">{product.description}</p>

          {product.contains?.length > 0 && (
            <div className="product-contains">
              <h2>You receive :</h2>
              <ul className="product-contains-list">
                {product.contains.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <ContactProduct productId={product.id} />
    </div>
  );
}

export default Product1;

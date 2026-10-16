import React, { useState } from "react";
import { Link } from "react-router-dom";
import Detail from "../components/Detail";
import { useProducts, getProductById } from "../lib/useShop";
import '../css/Catalog.css';

function Catalog() {
    const { products, loading, error } = useProducts();
    const [hoveredId, setHoveredId] = useState(null);
    if (loading) return <div className="Catalog"><p>Loading products…</p></div>;
    if (error) return <div className="Catalog"><p>Failed to load products.</p></div>;
    if (!products?.length) return <div className="Catalog"><p>No products yet.</p></div>;
    const hoveredProduct = getProductById(products, hoveredId || products[0]?.id) || products[0];
    return (
        <div className="Catalog">
        <Detail product={hoveredProduct} />
        <ul className="product-grid">

            {products.map((product) => (
            <li className="card-wrapper" id={product.id} key={product.id}
                onMouseEnter={() => setHoveredId(product.id)}
                onClick={() => setHoveredId(product.id)}>
                <span className="card-badge-status">{product.badge}</span>
                <Link to={`/product/${product.id}`}>
                    <img src={product.image} alt={product.name} className="product-img" id={`${product.id}-img`}/>
                </Link>
                <div className="small-detail">
                    <h2 className="product-label" id={`${product.id}-label`}>{product.name}</h2>
                    <div className="price-content">
                        <p className="price-label">Price 
                        <span className="product-price" id={`${product.id}-price`}>{product.price.toLocaleString()}</span>{product.currency}</p>
                    </div>
                </div>
                <hr />
            </li>
            ))}

        </ul>
        </div>
    );
}

export default Catalog
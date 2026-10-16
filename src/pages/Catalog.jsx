import React, { useState } from "react";
import { Link } from "react-router-dom";
import Detail from "../components/Detail";
import { products, getProductById } from "../data/products";
import '../css/Catalog.css';

function Catalog() {
    const [hoveredId, setHoveredId] = useState(products[0]?.id);
    const hoveredProduct = getProductById(hoveredId) || products[0];
    return (
        <div className="Catalog">
        <Detail product={hoveredProduct} />
        <ul className="product-grid">

            {products.map((product) => (
            <li className="card-wrapper" id={product.id} key={product.id}
                onMouseEnter={() => setHoveredId(product.id)}>
                <span className="card-badge-status">{product.badge}</span>    
                <Link to={`/product/${product.id}`}
                    onMouseEnter={() => setHoveredId(product.id)}>
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
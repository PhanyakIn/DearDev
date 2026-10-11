import React, { useState } from "react";
import { Link } from "react-router-dom";
import Detail from "../components/Detail";
import { products, getProductById } from "../data/products";
import '../css/Catalog.css';

function Catalog() {
    const prod1 = getProductById('prod1') || products[0];
    const [hoveredId, setHoveredId] = useState(prod1.id);
    const hoveredProduct = getProductById(hoveredId) || prod1;
    return (
        <div className="Catalog">
        <Detail product={hoveredProduct} />
        <ul className="product-grid">

            <li className="card-wrapper" id="prod1"
                onMouseEnter={() => setHoveredId(prod1.id)}>
                <span className="card-badge-status">{prod1.badge}</span>    
                <Link to="/product/prod1"
                    onMouseEnter={() => setHoveredId(prod1.id)}>
                    <img src={prod1.image} alt={prod1.name} className="product-img" id="prod1-img"/>
                </Link>
                <div className="small-detail">
                    <h2 className="product-label" id="prod1-label">{prod1.name}</h2>
                    <div className="price-content">
                        <p className="price-label">Price 
                        <span className="product-price" id="prod1-price">{prod1.price.toLocaleString()}</span>{prod1.currency}</p>
                    </div>
                </div>
                <hr />
            </li>

        </ul>
        </div>
    );
}

export default Catalog
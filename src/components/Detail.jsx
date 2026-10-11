import React from "react";
import { Link } from "react-router-dom";
import ProductVideo from "../data/ProductVideo";
import '../css/Detail.css'

function Detail({ product }) {
    if (!product) {
        return (
            <div className="Detail">
                <h1>Detail</h1>
                <p>Hover on the product image to view details.</p>
            </div>
        );
    }

    return (
        <div className="Detail">
            {product.videoUrl ? (
                <ProductVideo
                    key={product.id}
                    videoUrl={product.videoUrl}
                    title={`${product.name} video`}
                />
            ) : (
                <img src={product.image} alt={product.name} className="detail-image" />
            )}
            <h1 className="detail-name">{product.name}</h1>
            <p className="detail-price">
                Price <span>{product.price.toLocaleString()}</span>{product.currency}
            </p>
            <p className="detail-short">{product.shortDetail}</p>
            <hr />
            <p className="detail-desc">{product.description}</p>
            <Link to={`/product/${product.id}`} className="detail-more-btn">Check out</Link>
        </div>
    );
}

export default Detail

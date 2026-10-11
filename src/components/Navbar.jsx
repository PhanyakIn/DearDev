import React from "react";
import { Link, useLocation } from "react-router-dom";
import '../css/Navbar.css';

function Navbar() {
    const location = useLocation();
    const isProduct = location.pathname.startsWith("/product");
    const isNews = location.pathname === "/news";

    return (
        <header className={`Navbar${isProduct || isNews ? " Navbar--full" : ""}`}>
            <nav>
                <ul>
                    <li><Link to="/catalog">Catalog</Link></li>
                    <li><Link to="/news">News</Link></li>
                    <li><Link to="/contact">Contact</Link></li>
                </ul>
            </nav>
        </header>
    );
}

export default Navbar
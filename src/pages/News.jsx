import React from "react";
import '../css/News.css'

import news1img from '../images/News1.png';

function News() {
    return (
        <div className="News">
            <div className="news-img-wrapper">
                <img src={news1img} alt="new1-image" />
            </div>
            <div className="news-label-container">
                <div className="info-box1">
                    <h1>New product launch!</h1>
                    <p>Introducing a new product from DearDev! Check out the exciting Movement System R6 V1 (available exclusively on PC).</p>
                </div>
                <div className="info-box2">
                    <h1>How is it worth it!</h1>
                    <p>Introducing our very first product: the Movement System Version 1 for R6 models! (Only PC) It comes fully equipped with a comprehensive set of animations, sound effects (SFX), and visual effects (VFX). Installation is a breeze, and we’ve included a detailed guidebook that walks you through the setup process—plus tips on how to customize the system to perfectly suit your game. Available for purchase starting today!</p>
                </div>
            </div>
        </div>
    );
}

export default News

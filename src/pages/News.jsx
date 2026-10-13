import React from "react";
import '../css/News.css'

import news1img from '../images/EXAMPLE.jpg';

function News() {
    return (
        <div className="News">
            <div className="news-img-wrapper">
                <img src={news1img} alt="new1-image" />
            </div>
            <div className="news-label-container">
                <div className="info-box1">
                    <h1>News today</h1>
                    <p>New update here!</p>
                </div>
                <div className="info-box2">
                    <h1>Coming soon!</h1>
                    <p>Lorem ipsum dolor sit amet, consectetur adipisicing elit. Deserunt, iusto fugiat explicabo fugit ipsam mollitia cupiditate, labore ducimus accusantium non, inventore eum nesciunt. Repudiandae doloribus voluptatum quas molestias. Est, veritatis.</p>
                </div>
            </div>
        </div>
    );
}

export default News

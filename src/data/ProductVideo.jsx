import React from "react";
import { toYouTubeEmbed } from "./products";
import "../css/ProductVideo.css";

function ProductVideo({ videoUrl, title = "product video", autoplay = false }) {
  const videoEmbed = toYouTubeEmbed(videoUrl, { autoplay });

  if (!videoEmbed) return null;

  return (
    <div className="pv-wrap">
      <iframe
        src={videoEmbed}
        className="pv-frame"
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      ></iframe>
    </div>
  );
}

export default ProductVideo;

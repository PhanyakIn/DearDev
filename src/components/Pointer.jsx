import React, { useEffect, useRef, useState } from 'react';
import '../css/Pointer.css';

function Pointer() {
  const pointerRef = useRef(null);
  const previousFrame = useRef(0);
  const hasMoved = useRef(false);
  const mouse = useRef({
    x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
    y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
  });
  const rendered = useRef({ x: mouse.current.x, y: mouse.current.y });
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);
  const [shrinking, setShrinking] = useState(false);

  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return undefined;

    document.body.classList.add('custom-pointer-active');

    const onMove = (event) => {
      const { clientX: x, clientY: y } = event;
      mouse.current.x = x;
      mouse.current.y = y;

      if (!hasMoved.current) {
        rendered.current.x = x;
        rendered.current.y = y;
        hasMoved.current = true;
      }

      setVisible(true);

      const onVideo = event.target instanceof Element ? event.target.closest(
          'iframe, video, .pv-wrap'
        )
        : null;
      if (onVideo) {
        setShrinking(true);
        setExpanded(false);
        return;
      }
      setShrinking(false);

      const image = event.target instanceof Element ? event.target.closest(
          'img, .Navbar, .product-label, .price-label, .card-badge-status, .detail-more-btn, .product-contact-btns'
        ) //add more element here
        : null;
      setExpanded(Boolean(image));
    };

    const onLeave = (event) => {
      if (event.relatedTarget) return;
      setVisible(false);
      setExpanded(false);
      setShrinking(false);
    };
    const onBlur = () => {
      setVisible(false);
      setExpanded(false);
      setShrinking(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseout', onLeave);
    window.addEventListener('blur', onBlur);

    let raf = 0;
    const loop = (now) => {
      const deltaTime = Math.min((now - previousFrame.current) / 1000, 0.032);
      previousFrame.current = now;
      const ease = 1 - Math.exp(-12 * deltaTime);
      rendered.current.x += (mouse.current.x - rendered.current.x) * ease;
      rendered.current.y += (mouse.current.y - rendered.current.y) * ease;

      if (pointerRef.current) {
        pointerRef.current.style.transform = `translate3d(${rendered.current.x}px, ${rendered.current.y}px, 0) translate(-50%, -50%)`;
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseout', onLeave);
      window.removeEventListener('blur', onBlur);
      cancelAnimationFrame(raf);
      document.body.classList.remove('custom-pointer-active');
    };
  }, []);

  return (
    <div
        className={`pointer-layer${expanded ? ' pointer-layer--hover' : ''}${visible ? ' pointer-layer--visible' : ''}${shrinking ? ' pointer-layer--shrink' : ''}`}
        aria-hidden="true">
        <div ref={pointerRef} className="Pointer" />
    </div>
  );
}

export default Pointer;

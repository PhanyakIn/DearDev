import React, { useEffect, useRef, useState } from 'react';
import '../css/Pointer.css';

function Pointer() {
  const pointerRef = useRef(null);
  const previousFrame = useRef(0);
  const hasMoved = useRef(false);
  const frameCount = useRef(0);
  const shrinkingRef = useRef(false);
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

    const VIDEO_SELECTOR = 'iframe, video, .pv-wrap';

    const setShrink = (value) => {
      if (shrinkingRef.current !== value) {
        shrinkingRef.current = value;
        setShrinking(value);
      }
      if (value) setExpanded(false);
    };

    const pointInVideo = (x, y, pad = 8) => {
      const els = document.querySelectorAll(VIDEO_SELECTOR);
      for (let i = 0; i < els.length; i += 1) {
        const rect = els[i].getBoundingClientRect();
        if (x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad) {
          return true;
        }
      }
      return false;
    };

    const targetInVideo = (target) => (
      target instanceof Element ? Boolean(target.closest(VIDEO_SELECTOR)) : false
    );

    const applyHoverState = (x, y, target) => {
      if (targetInVideo(target) || pointInVideo(x, y)) {
        setShrink(true);
        return;
      }
      setShrink(false);

      const image = target instanceof Element ? target.closest(
          'img, a, button, .Navbar, .product-label, .price-label, .card-badge-status, .detail-more-btn, .product-contact-btns, .contact-btn, .profile-btn, .profile-links, .footer-nav, .footer-contact'
        ) //add more element here
        : null;
      setExpanded(Boolean(image));
    };

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
      applyHoverState(x, y, event.target);
    };

    const syncCoords = (event) => {
      const x = typeof event.clientX === 'number' ? event.clientX : mouse.current.x;
      const y = typeof event.clientY === 'number' ? event.clientY : mouse.current.y;
      mouse.current.x = x;
      mouse.current.y = y;
      if (!hasMoved.current) {
        rendered.current.x = x;
        rendered.current.y = y;
        hasMoved.current = true;
      }
      return { x, y };
    };

    const onOver = (event) => {
      if (targetInVideo(event.target)) {
        syncCoords(event);
        setVisible(true);
        setShrink(true);
        return;
      }
      
      if (event.relatedTarget) return;
      const { x, y } = syncCoords(event);
      setVisible(true);
      applyHoverState(x, y, event.target);
    };

    const onLeave = (event) => {
      const fromVideo = targetInVideo(event.target);
      const toVideo = event.relatedTarget instanceof Element
        ? Boolean(event.relatedTarget.closest(VIDEO_SELECTOR))
        : false;

      if (!fromVideo && toVideo) {
        syncCoords(event);
        setShrink(true);
        return;
      }

      if (fromVideo && !toVideo && event.relatedTarget) {
        const { x, y } = syncCoords(event);
        setVisible(true);
        applyHoverState(x, y, event.relatedTarget);
        return;
      }

      if (event.relatedTarget) return;
      if (pointInVideo(mouse.current.x, mouse.current.y, 12)) {
        setShrink(true);
        return;
      }
      setVisible(false);
      setExpanded(false);
      setShrink(false);
    };
    const onBlur = () => {
      setVisible(false);
      setExpanded(false);
      setShrink(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseover', onOver);
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

      frameCount.current += 1;
      if (frameCount.current % 6 === 0 && hasMoved.current) {
        if (pointInVideo(mouse.current.x, mouse.current.y)) {
          setShrink(true);
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseover', onOver);
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

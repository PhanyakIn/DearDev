import React from 'react';

import Pointer from '../components/Pointer';
import Navbar from '../components/Navbar';
import Catalog from './Catalog';
import News from './News';
import Contact from './Contact';
import { Routes, Route, Navigate } from 'react-router-dom';

import Product1 from '../stock/Product1';

function App() {
  return (
    <div className="App">
        <Navbar/>
        <Routes>
          <Route path="/" element={<Navigate to="/catalog" replace />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/news" element={<News />} />
          <Route path="/contact" element={<Contact />} />

          <Route path="/product/prod1" element={<Product1 />} />
        </Routes>
        <Pointer/>
    </div>
  );
}

export default App;

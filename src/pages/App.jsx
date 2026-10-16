import React from 'react';

import Pointer from '../components/Pointer';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer'
import Catalog from './Catalog';
import News from './News';
import Contact from './Contact';
import { Routes, Route, Navigate } from 'react-router-dom';

import Product1 from './Product1';

function App() {
  return (
    <div className="App">
        <Navbar/>
        <main className="App-main">
        <Routes>
          <Route path="/" element={<Navigate to="/catalog" replace />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/news" element={<News />} />
          <Route path="/contact" element={<Contact />} />

          <Route path="/product/prod1" element={<Product1 />} />
          <Route path="/product/:id" element={<Product1 />} />
        </Routes>
        </main>
        <Pointer/>
        <Footer/>
    </div>
  );
}

export default App;

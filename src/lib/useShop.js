import { useEffect, useState } from 'react';
import { fetchProducts, fetchContact } from '../lib/shopApi';

export function useProducts() {
  const [products, setProducts] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    fetchProducts().then(setProducts).catch(setError);
  }, []);
  return { products, error, loading: products === null && !error };
}

export function useContact() {
  const [contact, setContact] = useState({ discord: '', facebook: '' });
  useEffect(() => {
    fetchContact().then(setContact).catch(() => {});
  }, []);
  return contact;
}

export function getProductById(products, id) {
  return (products || []).find((p) => p.id === id);
}

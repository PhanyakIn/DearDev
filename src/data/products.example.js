// Sample file for inspiration — does not affect the actual store.
// Usage: Copy this file as products.js and fill in your own names, prices, and details.
import product1Img from '../images/EXAMPLE.jpg'; // Your path image file

//Just example products
export const products = [
  {
    id: 'prod1',
    name: 'Product 1',
    price: 1000,
    currency: '฿THB',
    image: product1Img,
    badge: 'Sell',
    shortDetail: 'short detail',
    description: 'Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industrys standard dummy text ever since 1966, when designers',
    videoUrl: 'YOUR YOUTUBE VIDEO URL',
    contains: [
      'Auto Sprint',
      'Cam Sway',
      'Wall Running',
      'Laché',
      'Ledge Hanging',
      'Wall Climbable',
      'Obstacle Vaulting',
      'Easy to customize',
      'Free Animations',
      'Free SFX',
      'Free VFX',
    ],
  },
];

export const getProductById = (id) => products.find((p) => p.id === id);

export const contact = {
  discord: 'YOUR DISCORD URL',
  facebook: 'YOUR FACEBOOK URL',
};

export const toYouTubeEmbed = (url, { autoplay = false, controls = true } = {}) => {
  if (!url) return '';
  let embed = url;
  if (!url.includes('/embed/')) {
    const match = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
    embed = match ? `https://www.youtube.com/embed/${match[1]}` : url;
  }
  const params = ['enablejsapi=1'];
  if (autoplay) params.push('autoplay=1', 'mute=1');
  if (!controls) params.push('controls=0', 'rel=0');
  const sep = embed.includes('?') ? '&' : '?';
  return `${embed}${sep}${params.join('&')}`;
};

export const getYouTubeId = (url) => {
  if (!url) return '';
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return match ? match[1] : '';
};


export const toYouTubeWatch = (url) => {
  const id = getYouTubeId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : url;
};

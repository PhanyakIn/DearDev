// YouTube helpers — moved out of products.js so video embeds
// work whether data comes from Supabase or the local fallback file.
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

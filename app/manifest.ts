import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nova · Flowminds',
    short_name: 'Nova',
    description: 'Run your CRM with one prompt.',
    start_url: '/',
    display: 'standalone',
    background_color: '#121314',
    theme_color: '#121314',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}

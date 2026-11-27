import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { CreativeFitPreview } from '../../components/admin/creative-fit-preview';
import type { PreviewLayout } from '../../lib/admin/creative-fit';

function Fixture() {
  const [layout, setLayout] = useState<PreviewLayout>('MBOX_AD_QR_SPONSOR_V1');
  const [slot, setSlot] = useState<'MAIN' | 'SPONSORED'>('MAIN');
  return <main className="mx-auto max-w-5xl p-8">
    <h1 className="mb-4 text-lg font-bold">Local campaign layout preview</h1>
    <label>Preview creative slot<select aria-label="Preview creative slot" value={slot} onChange={event => setSlot(event.target.value as 'MAIN' | 'SPONSORED')}><option value="MAIN">Main</option><option value="SPONSORED">Sponsored</option></select></label>
    <CreativeFitPreview file={null} layout={layout} slot={slot} onLayoutChange={setLayout} offer={{ brandName: 'Fixture Brand', offerTitle: 'Approved offer preview', offerValue: '10% OFF', ctaLabel: 'SCAN TO EXPLORE' }}/>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture/>);

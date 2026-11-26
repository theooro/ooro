import { createRoot } from 'react-dom/client';
import { LayoutStudio } from '../../components/admin/layout-studio';

// Bundled only by the loopback test server. Never included in Next routes or deployed Admin auth.
createRoot(document.getElementById('root')!).render(<div className="px-4 py-7 sm:px-7 sm:py-9 lg:px-10 lg:py-10"><LayoutStudio canEdit canPublish/></div>);

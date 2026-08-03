/** Public health probe. */

import { Router } from 'express';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'olympus', at: new Date().toISOString() });
});

export default router;

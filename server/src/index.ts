import express from 'express';
import path from 'path';
import fs from 'fs';
import './db';
import { api } from './routes';
import { mcp } from './mcp';
import { watch } from './watch';
import { listProfiles, ensureBlock, migrateLegacyLog, seedPrograms } from './store';

seedPrograms();
for (const p of listProfiles()) ensureBlock(p);
migrateLegacyLog();

const app = express();
const PORT = Number(process.env.PORT) || 8080;

app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use('/api', api);
app.use('/mcp', mcp);
app.use('/watch', watch);

const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/mcp') || req.path.startsWith('/watch')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Iron + Engine listening on port ${PORT}`);
});

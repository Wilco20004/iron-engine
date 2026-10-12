import express from 'express';
import path from 'path';
import fs from 'fs';
import './db';
import { api } from './routes';

const app = express();
const PORT = Number(process.env.PORT) || 8080;

app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use('/api', api);

const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Iron + Engine listening on port ${PORT}`);
});

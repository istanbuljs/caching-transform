import path from 'path';
import {fileURLToPath} from 'url';
import fs from 'fs';
import {createHash} from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.join(__dirname, 'package.json');
const data = fs.readFileSync(filePath);

export default createHash('sha256').update(data).digest('hex');

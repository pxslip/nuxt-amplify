import { handler } from '../dist/origin-request-handler/index.mjs';
import test from './index-event.json' assert { type: 'json' };

console.log(JSON.stringify(await handler(test)));

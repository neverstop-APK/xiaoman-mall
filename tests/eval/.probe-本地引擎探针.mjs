import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
process.env.XM_DATA_DIR = path.resolve('tests/eval/.tmpdata');
const localBrain = require('../../server/agent/localbrain-本地规则引擎.js');
const tools = require('../../server/agent/tools-工具集.js');
const store = require('../../server/agent/conversation-会话存储.js');

const messages = process.argv.slice(2);
for (const message of messages) {
  const conversation = store.create({ userId: null, cartId: '' });
  const trace = [];
  const events = [];
  const result = await tools.withTrace(trace, () => localBrain.run({ conversation, message, emit: (t, p) => events.push([t, p]), user: null }));
  console.log(JSON.stringify({
    message,
    reply: result.reply,
    products: (result.products || []).map((p) => p.name + '|' + p.price),
    eventProducts: events.filter(([t]) => t === 'products').map(([, p]) => p.map((x) => x.id + ':' + x.price)),
    cart: result.cart ? { qty: result.cart.totalQuantity, amount: result.cart.totalAmount, items: result.cart.items.map((i) => i.productId + 'x' + i.quantity) } : null,
    action: result.action ? { id: result.action.id, amount: result.action.amount, qty: result.action.quantity } : null,
    tools: trace.map((t) => ({ name: t.name, args: t.args, ok: t.ok, summary: t.summary })),
    events: events.map(([t]) => t)
  }, null, 2));
}
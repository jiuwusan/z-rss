import { createApp } from './app.js';
import config from './config/index.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`服务已启动：http://localhost:${config.port}`);
});

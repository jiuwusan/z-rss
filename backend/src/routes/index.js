import Router from '@koa/router';
import healthRouter from './health.route.js';

const router = new Router();

router.use(healthRouter.routes(), healthRouter.allowedMethods());

export default router;

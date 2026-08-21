import { spawn, execSync } from 'child_process';
import http from 'http';

const PORT = process.env.PORT || '5001';
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}




function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    let bodyData = '';
    if (options.body) {
      if (typeof options.body === 'object') {
        bodyData = JSON.stringify(options.body);
        reqOptions.headers['Content-Type'] = 'application/json';
      } else {
        bodyData = options.body;
      }
      reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyData);
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          json: () => JSON.parse(data),
          text: () => data,
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (bodyData) {
      req.write(bodyData);
    }
    req.end();
  });
}

async function main() {
  console.log(`[Integration Test] Starting Express application server on port ${PORT}...`);
  console.log(`[Integration Test] DB_PATH is: ${process.env.DB_PATH || 'default'}`);

  // Spawn the tsx process to start Express server
  const server = spawn('npx', ['tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      PORT: PORT,
      NODE_ENV: 'test-integration',
    },
    stdio: 'inherit',
    shell: true,
  });

  let serverStarted = false;
  const timeoutMs = 25000; // 25s timeout
  const start = Date.now();

  // Poll health endpoint
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await makeRequest(`${BASE_URL}/api/health`);
      if (res.status === 200) {
        const body = res.json();
        if (body.status === 'ok') {
          serverStarted = true;
          console.log('[Integration Test] Server is ready!');
          break;
        }
      }
    } catch (e) {
      // Server not ready yet
    }
    await sleep(500);
  }

  if (!serverStarted) {
    console.error('[Integration Test] ERROR: Server failed to start and respond to health check within timeout.');
    cleanup(server);
    process.exit(1);
  }

  try {
    // Test 1: Health check details
    console.log('[Integration Test] Running Test 1: Health Endpoint validation...');
    const healthRes = await makeRequest(`${BASE_URL}/api/health`);
    const health = healthRes.json();
    if (health.service !== 'QueueCraft Staff Operations Module') {
      throw new Error(`Unexpected service name: ${health.service}`);
    }
    console.log('[Integration Test] Test 1: SUCCESS');

    // Test 2: Login validation
    console.log('[Integration Test] Running Test 2: Authentication / Login validation...');
    const loginRes = await makeRequest(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      body: {
        email: 'student@queuecraft.edu',
        password: 'password123',
      },
    });

    if (loginRes.status !== 200) {
      throw new Error(`Login failed with status code ${loginRes.status}: ${await loginRes.text()}`);
    }

    const auth = loginRes.json();
    if (!auth.token) {
      throw new Error('Login response did not return an access token.');
    }
    if (auth.user.role !== 'STUDENT' || auth.user.email !== 'student@queuecraft.edu') {
      throw new Error(`Invalid user details returned: ${JSON.stringify(auth.user)}`);
    }
    console.log('[Integration Test] Test 2: SUCCESS');

    // Test 3: Authenticated access to services
    console.log('[Integration Test] Running Test 3: Authenticated API data lookup...');
    const servicesRes = await makeRequest(`${BASE_URL}/api/student/services`, {
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });

    if (servicesRes.status !== 200) {
      throw new Error(`Services lookup failed with status ${servicesRes.status}`);
    }

    const servicesData = servicesRes.json();
    if (!servicesData.services || !Array.isArray(servicesData.services)) {
      throw new Error(`Services response structure invalid: ${JSON.stringify(servicesData)}`);
    }

    console.log(`[Integration Test] Found ${servicesData.services.length} services in seeded database.`);
    const lpService = servicesData.services.find(s => s.code === 'LP');
    if (!lpService) {
      throw new Error('Could not find seeded LP (Library Printer) service.');
    }
    console.log(`[Integration Test] LP Service verified: "${lpService.name}"`);
    console.log('[Integration Test] Test 3: SUCCESS');

    console.log('[Integration Test] All integration smoke tests passed successfully!');
    cleanup(server);
    process.exit(0);
  } catch (err) {
    console.error('[Integration Test] FATAL ERROR during execution:', err.message);
    cleanup(server);
    process.exit(1);
  }
}

function cleanup(server) {
  console.log('[Integration Test] Shutting down application server...');
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${server.pid} /T /F`);
    } catch (e) {
      // already stopped
    }
  } else {
    try {
      server.kill('SIGTERM');
    } catch (e) {
      // already stopped
    }
  }
}

main();

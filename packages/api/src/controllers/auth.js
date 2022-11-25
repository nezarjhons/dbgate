const axios = require('axios');
const jwt = require('jsonwebtoken');
const getExpressPath = require('../utility/getExpressPath');
const uuidv1 = require('uuid/v1');
const { getLogins } = require('../utility/hasPermission');
const AD = require('activedirectory2').promiseWrapper;

const tokenSecret = uuidv1();

function shouldAuthorizeApi() {
  return !!process.env.OAUTH_AUTH;
}

function unauthorizedResponse(req, res, text) {
  // if (req.path == getExpressPath('/config/get-settings')) {
  //   return res.json({});
  // }
  // if (req.path == getExpressPath('/connections/list')) {
  //   return res.json([]);
  // }
  return res.sendStatus(401).send(text);
}

function authMiddleware(req, res, next) {
  const SKIP_AUTH_PATHS = ['/config/get', '/auth/oauth-token', 'auth/login', '/stream'];

  if (!shouldAuthorizeApi()) {
    return next();
  }
  if (SKIP_AUTH_PATHS.find(x => req.path == getExpressPath(x))) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return unauthorizedResponse(req, res, 'missing authorization header');
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, tokenSecret);
    req.user = decoded;
    return next();
  } catch (err) {
    return unauthorizedResponse(req, res, 'invalid token');
  }
}

module.exports = {
  oauthToken_meta: true,
  async oauthToken(params) {
    const { redirectUri, code } = params;

    const resp = await axios.default.post(
      `${process.env.OAUTH_TOKEN}`,
      `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&client_id=${process.env.OAUTH_CLIENT_ID}&client_secret=${process.env.OAUTH_CLIENT_SECRET}`
    );

    const { access_token, refresh_token } = resp.data;

    const payload = jwt.decode(access_token);

    const login = process.env.OAUTH_LOGIN_FIELD ? payload[process.env.OAUTH_LOGIN_FIELD] : 'oauth';

    if (access_token) {
      return {
        accessToken: jwt.sign({ login }, tokenSecret, { expiresIn: '1m' }),
      };
    }

    return { error: 'Token not found' };
  },
  login_meta: true,
  async login(params) {
    const { login, password } = params;

    if (process.env.AD_URL) {
      const adConfig = {
        url: process.env.AD_URL,
        baseDN: process.env.AD_BASEDN,
        username: process.env.AD_USERNAME,
        password: process.env.AD_PASSOWRD,
      };
      const ad = new AD(adConfig);
      try {
        const res = await ad.authenticate(login, password);
        if (!res) {
          return { error: 'login failed' };
        }
        return {
          accessToken: jwt.sign({ login }, tokenSecret, { expiresIn: '1m' }),
        };
      } catch (err) {
        console.log('Failed active directory authentization', err.message);
        return { error: err.message };
      }
    }

    const logins = getLogins();
    if (!logins) {
      return { error: 'Logins not configured' };
    }
    if (logins[login] == password) {
      return {
        accessToken: jwt.sign({ login }, tokenSecret, { expiresIn: '1m' }),
      };
    }
    return { error: 'Invalid credentials' };
  },

  authMiddleware,
  shouldAuthorizeApi,
};

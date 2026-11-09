const twilioApiBase = 'https://api.twilio.com/2010-04-01/Accounts';

export class TwilioSmsProvider {
  constructor({ accountSid, authToken, fromNumber }) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.fromNumber = fromNumber;
  }

  async sendOtp({ phoneNumber, code }) {
    const form = new URLSearchParams({
      To: phoneNumber,
      From: this.fromNumber,
      Body: 'Tu código de Mi Barrio es ' + code + '. Vence en 5 minutos. No lo compartas.',
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response;
    try {
      response = await fetch(twilioApiBase + '/' + this.accountSid + '/Messages.json', {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(this.accountSid + ':' + this.authToken).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
        signal: controller.signal,
      });
    } catch {
      const error = new Error('El proveedor SMS no respondió. Inténtalo nuevamente.');
      error.status = 503;
      error.code = 'OTP_DELIVERY_UNAVAILABLE';
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = new Error('No pudimos enviar el SMS. Verifica el número e inténtalo nuevamente.');
      error.status = response.status === 429 ? 429 : 503;
      error.code = response.status === 429 ? 'OTP_PROVIDER_RATE_LIMIT' : 'OTP_DELIVERY_UNAVAILABLE';
      throw error;
    }
    return { accepted: true };
  }
}

export class DisabledOtpProvider {
  async sendOtp() {
    const error = new Error('El envío de SMS no está configurado. Configura Twilio en el servidor.');
    error.status = 503;
    error.code = 'OTP_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
}

export class SimulatedSmsProvider {
  async sendOtp({ code }) {
    return { accepted: true, demoCode: code };
  }
}

export function createOtpProvider() {
  const provider = process.env.OTP_PROVIDER ?? 'disabled';
  const demoMode = process.env.OTP_DEMO_MODE === 'true';
  const development = process.env.NODE_ENV === 'development';

  if (process.env.NODE_ENV === 'production' && (demoMode || provider === 'simulated' || provider === 'mock')) {
    throw new Error('Simulated OTP is forbidden in production. Set OTP_PROVIDER=twilio or disabled.');
  }

  if (provider === 'simulated' || provider === 'mock') {
    if (!development || !demoMode) {
      throw new Error('Simulated OTP requires NODE_ENV=development and OTP_DEMO_MODE=true.');
    }
    return new SimulatedSmsProvider();
  }

  if (demoMode) {
    throw new Error('OTP_DEMO_MODE=true requires OTP_PROVIDER=simulated and NODE_ENV=development.');
  }

  switch (process.env.OTP_PROVIDER ?? 'disabled') {
    case 'disabled': return new DisabledOtpProvider();
    case 'twilio': {
      const { TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: authToken, TWILIO_PHONE_NUMBER: fromNumber } = process.env;
      if (!accountSid || !authToken || !/^\+[1-9]\d{7,14}$/.test(fromNumber ?? '')) {
        throw new Error('Twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and a valid TWILIO_PHONE_NUMBER.');
      }
      return new TwilioSmsProvider({ accountSid, authToken, fromNumber });
    }
    default: throw new Error('OTP_PROVIDER must be "disabled", "twilio" or "simulated".');
  }
}

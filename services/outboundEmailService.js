const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const COMPANY_NAME = 'YOUR HR POWER';

let transporter = null;

function getSmtpConfig() {
  const user =
    process.env.OUTLOOK_USER ||
    process.env.IMAP_USER ||
    process.env.SMTP_USER ||
    '';
  const pass =
    process.env.OUTLOOK_PASSWORD ||
    process.env.IMAP_PASSWORD ||
    process.env.SMTP_PASSWORD ||
    '';

  const explicitHost = process.env.SMTP_HOST;
  const explicitPort = process.env.SMTP_PORT
    ? parseInt(process.env.SMTP_PORT, 10)
    : undefined;
  const explicitSecure =
    typeof process.env.SMTP_SECURE === 'string'
      ? process.env.SMTP_SECURE === 'true'
      : undefined;

  if (!user || !pass) {
    console.warn(
      '⚠️ Outbound email disabled: missing SMTP credentials. Set SMTP_USER/SMTP_PASSWORD or OUTLOOK_USER/OUTLOOK_PASSWORD or IMAP_USER/IMAP_PASSWORD.',
    );
    return null;
  }

  let host = explicitHost;
  let port = explicitPort;
  let secure = explicitSecure;

  const lowerUser = user.toLowerCase();

  if (!host) {
    if (lowerUser.endsWith('@gmail.com')) {
      host = 'smtp.gmail.com';
      port = port || 465;
      if (typeof secure === 'undefined') secure = true;
    } else if (
      /@(outlook|hotmail|live)\.com$/.test(lowerUser) ||
      lowerUser.endsWith('@office365.com')
    ) {
      host = 'smtp.office365.com';
      port = port || 587;
      if (typeof secure === 'undefined') secure = false;
    } else {
      host = 'smtp.gmail.com';
      port = port || 587;
      if (typeof secure === 'undefined') secure = false;
    }
  }

  if (typeof secure === 'undefined') {
    secure = port === 465;
  }

  return {
    host,
    port,
    secure,
    auth: { user, pass },
    from: process.env.SMTP_FROM || user,
  };
}

function getTransporter() {
  if (transporter) return transporter;

  const config = getSmtpConfig();
  if (!config) {
    transporter = null;
    return null;
  }

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });

  transporter.verify().catch((err) => {
    console.warn('⚠️ SMTP verify failed. Emails may not send:', err.message);
  });

  transporter._fromAddress = config.from;
  return transporter;
}

module.exports = {
  getTransporter,
};


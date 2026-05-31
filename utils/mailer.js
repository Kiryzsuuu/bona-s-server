const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const sendMail = async ({ to, subject, html }) => {
  return transporter.sendMail({
    from: `"Bonah Server 🦋" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html
  });
};

module.exports = { sendMail };

const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    // Check if credentials are properly configured (not default placeholders)
    const isConfigured = smtpUser &&
      smtpPass &&
      !smtpUser.includes('your_email') &&
      !smtpPass.includes('your_app_password');

    if (!isConfigured) {
      console.log('EmailService: SMTP not configured or using default placeholders. Emails will be suppressed.');
      // Create a mock transporter
      this.transporter = {
        sendMail: async (mailOptions) => {
          // Silent success to prevent application errors
          // console.log(`[Mock Email] Subject: ${mailOptions.subject} | To: ${mailOptions.to}`);
          return { messageId: 'mock-id-suppressed' };
        }
      };
    } else {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: process.env.SMTP_PORT || 587,
        secure: false, // true for 465, false for other ports
        auth: {
          user: smtpUser,
          pass: smtpPass
        }
      });
    }
  }

  async sendPasswordResetEmail(user, resetToken) {
    try {
      const resetUrl = `${process.env.CLIENT_URL}/auth/reset-password?token=${resetToken}`;

      const mailOptions = {
        from: `"SPIRELEAP Real Estate" <${process.env.SMTP_USER}>`,
        to: user.email,
        subject: 'Password Reset Request',
        html: this.generatePasswordResetHTML(user, resetUrl),
        text: this.generatePasswordResetText(user, resetUrl)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Password reset email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending password reset email:', error);
      throw error;
    }
  }

  async sendWelcomeEmail(user) {
    try {
      const mailOptions = {
        from: `"SPIRELEAP Real Estate" <${process.env.SMTP_USER}>`,
        to: user.email,
        subject: 'Welcome to SPIRELEAP Real Estate CRM',
        html: this.generateWelcomeEmailHTML(user),
        text: this.generateWelcomeEmailText(user)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Welcome email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending welcome email:', error);
      throw error;
    }
  }

  generatePasswordResetHTML(user, resetUrl) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Password Reset Request</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .button { display: inline-block; background: #2c5aa0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Password Reset Request</h1>
          <p>Dear ${user.firstName} ${user.lastName},</p>
          <p>You have requested to reset your password for your SPIRELEAP Real Estate CRM account.</p>
          <p>Click the button below to reset your password:</p>
          <a href="${resetUrl}" class="button">Reset Password</a>
          <p>This link will expire in 1 hour for security reasons.</p>
          <p>If you didn't request this password reset, please ignore this email.</p>
          <p>Best regards,<br>SPIRELEAP Real Estate Team</p>
        </div>
      </body>
      </html>
    `;
  }

  generatePasswordResetText(user, resetUrl) {
    return `
Password Reset Request

Dear ${user.firstName} ${user.lastName},

You have requested to reset your password for your Alvasco Procurement System account.

Click the link below to reset your password:
${resetUrl}

This link will expire in 1 hour for security reasons.

If you didn't request this password reset, please ignore this email.

Best regards,
SPIRELEAP Real Estate Team
    `;
  }

  async sendAccountCreatedNotification(user, password) {
    try {
      const mailOptions = {
        from: `"SPIRELEAP Real Estate" <${process.env.SMTP_USER}>`,
        to: user.email,
        subject: 'Your SPIRELEAP CRM Account Credentials',
        html: this.generateAccountCreatedHTML(user, password),
        text: this.generateAccountCreatedText(user, password)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Account creation email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending account creation email:', error);
      throw error;
    }
  }

  generateAccountCreatedHTML(user, password) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Account Created - SPIRELEAP CRM</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2c5aa0; color: white; padding: 20px; border-radius: 5px; text-align: center; }
          .content { padding: 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 5px 5px; }
          .creds { background: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .button { display: inline-block; background: #2c5aa0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Welcome to SPIRELEAP CRM</h1>
          </div>
          <div class="content">
            <p>Dear ${user.firstName} ${user.lastName},</p>
            <p>An administrator has created your account on the SPIRELEAP Real Estate CRM.</p>
            <p><strong>Account Details:</strong></p>
            <ul>
              <li><strong>Role:</strong> ${user.role.charAt(0).toUpperCase() + user.role.slice(1)}</li>
              <li><strong>Agency:</strong> ${user.agency?.name || 'SPIRELEAP'}</li>
            </ul>
            <div class="creds">
              <p style="margin-top: 0;"><strong>Your Login Credentials:</strong></p>
              <p><strong>Email:</strong> ${user.email}</p>
              <p><strong>Password:</strong> ${password}</p>
            </div>
            <p style="color: #666; font-size: 14px;">Please change your password after your first login for better security.</p>
            <div style="text-align: center;">
              <a href="${process.env.CLIENT_URL}/auth/login" class="button">Login Now</a>
            </div>
            <p>Best regards,<br>SPIRELEAP Real Estate Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateAccountCreatedText(user, password) {
    return `
Welcome to SPIRELEAP Real Estate CRM!

Dear ${user.firstName} ${user.lastName},

An administrator has created your account on the SPIRELEAP Real Estate CRM.

Account Details:
- Role: ${user.role.charAt(0).toUpperCase() + user.role.slice(1)}
- Agency: ${user.agency?.name || 'SPIRELEAP'}

Your Login Credentials:
- Email: ${user.email}
- Password: ${password}

Please change your password after your first login for better security.

Login here: ${process.env.CLIENT_URL}/auth/login

Best regards,
SPIRELEAP Real Estate Team
    `;
  }

  generateWelcomeEmailHTML(user) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Welcome to SPIRELEAP Real Estate CRM</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .button { display: inline-block; background: #2c5aa0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Welcome to SPIRELEAP Real Estate CRM!</h1>
          <p>Dear ${user.firstName} ${user.lastName},</p>
          <p>Welcome to the SPIRELEAP Real Estate CRM! Your account has been successfully created.</p>
          <p>Your role: <strong>${user.role.charAt(0).toUpperCase() + user.role.slice(1)}</strong></p>
          <p>You can now access the system and start using all the features available to your role.</p>
          <a href="${process.env.CLIENT_URL}/auth/login" class="button">Login to System</a>
          <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
          <p>Best regards,<br>SPIRELEAP Real Estate Team</p>
        </div>
      </body>
      </html>
    `;
  }

  generateWelcomeEmailText(user) {
    return `
Welcome to SPIRELEAP Real Estate CRM!

Dear ${user.firstName} ${user.lastName},

Welcome to the SPIRELEAP Real Estate CRM! Your account has been successfully created.

Your role: ${user.role.charAt(0).toUpperCase() + user.role.slice(1)}

You can now access the system and start using all the features available to your role.

Login to the system: ${process.env.CLIENT_URL}/auth/login

If you have any questions or need assistance, please don't hesitate to contact our support team.

Best regards,
SPIRELEAP Real Estate Team
    `;
  }

  async sendNewLeadNotification(lead, agent, agency) {
    try {
      if (!agent || !agent.email) {
        console.log('Agent email not available for lead notification');
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: agent.email,
        subject: `New Lead Assigned: ${lead.contact.firstName} ${lead.contact.lastName}`,
        html: this.generateLeadNotificationHTML(lead, agent, agency),
        text: this.generateLeadNotificationText(lead, agent, agency)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Lead notification email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending lead notification email:', error);
      throw error;
    }
  }

  async sendLeadAssignmentNotification(lead, agent, agency) {
    try {
      if (!agent || !agent.email) {
        console.log('Agent email not available for assignment notification');
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: agent.email,
        subject: `Lead Assigned to You: ${lead.contact.firstName} ${lead.contact.lastName}`,
        html: this.generateLeadAssignmentHTML(lead, agent, agency),
        text: this.generateLeadAssignmentText(lead, agent, agency)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Lead assignment email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending lead assignment email:', error);
      throw error;
    }
  }

  generateLeadNotificationHTML(lead, agent, agency) {
    const propertyInfo = lead.property
      ? `<p><strong>Property:</strong> ${lead.property.title}</p>`
      : '<p><strong>Type:</strong> General Inquiry</p>';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>New Lead Assigned</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
          .lead-details { background: #fff; border: 1px solid #ddd; padding: 20px; border-radius: 5px; }
          .button { display: inline-block; background: #2c5aa0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>New Lead Assigned</h1>
            <p>Dear ${agent.firstName} ${agent.lastName},</p>
            <p>A new lead has been assigned to you.</p>
          </div>
          
          <div class="lead-details">
            <h2>Lead Information</h2>
            <p><strong>Name:</strong> ${lead.contact.firstName} ${lead.contact.lastName}</p>
            <p><strong>Email:</strong> ${lead.contact.email}</p>
            <p><strong>Phone:</strong> ${lead.contact.phone}</p>
            ${propertyInfo}
            <p><strong>Status:</strong> ${lead.status}</p>
            <p><strong>Priority:</strong> ${lead.priority}</p>
            ${lead.inquiry?.message ? `<p><strong>Message:</strong> ${lead.inquiry.message}</p>` : ''}
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL}/agency/leads/${lead._id}" class="button">View Lead Details</a>
            </div>
            
            <p>Please contact this lead as soon as possible.</p>
            
            <p>Best regards,<br>
            ${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateLeadNotificationText(lead, agent, agency) {
    const propertyInfo = lead.property ? `Property: ${lead.property.title}` : 'Type: General Inquiry';

    return `
New Lead Assigned

Dear ${agent.firstName} ${agent.lastName},

A new lead has been assigned to you.

Lead Information:
- Name: ${lead.contact.firstName} ${lead.contact.lastName}
- Email: ${lead.contact.email}
- Phone: ${lead.contact.phone}
- ${propertyInfo}
- Status: ${lead.status}
- Priority: ${lead.priority}
${lead.inquiry?.message ? `- Message: ${lead.inquiry.message}` : ''}

View lead details: ${process.env.CLIENT_URL}/agency/leads/${lead._id}

Please contact this lead as soon as possible.

Best regards,
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  generateLeadAssignmentHTML(lead, agent, agency) {
    return this.generateLeadNotificationHTML(lead, agent, agency);
  }

  generateLeadAssignmentText(lead, agent, agency) {
    return this.generateLeadNotificationText(lead, agent, agency);
  }

  async sendPropertyApprovalNotification(property, agent, agency) {
    try {
      if (!agent || !agent.email) {
        console.log('Agent email not available for property approval notification');
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: agent.email,
        subject: `Property Approved: ${property.title}`,
        html: this.generatePropertyApprovalHTML(property, agent, agency),
        text: this.generatePropertyApprovalText(property, agent, agency)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Property approval email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending property approval email:', error);
      throw error;
    }
  }

  async sendPropertyRejectionNotification(property, agent, agency, reason) {
    try {
      if (!agent || !agent.email) {
        console.log('Agent email not available for property rejection notification');
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: agent.email,
        subject: `Property Rejected: ${property.title}`,
        html: this.generatePropertyRejectionHTML(property, agent, agency, reason),
        text: this.generatePropertyRejectionText(property, agent, agency, reason)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Property rejection email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending property rejection email:', error);
      throw error;
    }
  }

  generatePropertyApprovalHTML(property, agent, agency) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Property Approved</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #d4edda; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
          .property-details { background: #fff; border: 1px solid #ddd; padding: 20px; border-radius: 5px; }
          .button { display: inline-block; background: #2c5aa0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Property Approved!</h1>
            <p>Dear ${agent.firstName} ${agent.lastName},</p>
            <p>Great news! Your property listing has been approved and is now live.</p>
          </div>
          
          <div class="property-details">
            <h2>Property Details</h2>
            <p><strong>Title:</strong> ${property.title}</p>
            <p><strong>Location:</strong> ${property.location?.address || 'N/A'}, ${property.location?.city || 'N/A'}</p>
            <p><strong>Type:</strong> ${property.propertyType}</p>
            <p><strong>Listing Type:</strong> ${property.listingType}</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL}/properties/${property.slug || property._id}" class="button">View Property</a>
            </div>
            
            <p>Your property is now visible to potential buyers/renters on the website.</p>
            
            <p>Best regards,<br>
            ${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generatePropertyApprovalText(property, agent, agency) {
    return `
Property Approved

Dear ${agent.firstName} ${agent.lastName},

Great news! Your property listing has been approved and is now live.

Property Details:
- Title: ${property.title}
- Location: ${property.location?.address || 'N/A'}, ${property.location?.city || 'N/A'}
- Type: ${property.propertyType}
- Listing Type: ${property.listingType}

View property: ${process.env.CLIENT_URL}/properties/${property.slug || property._id}

Your property is now visible to potential buyers/renters on the website.

Best regards,
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  generatePropertyRejectionHTML(property, agent, agency, reason) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Property Rejected</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f8d7da; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
          .property-details { background: #fff; border: 1px solid #ddd; padding: 20px; border-radius: 5px; }
          .reason-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
          .button { display: inline-block; background: #2c5aa0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⚠️ Property Rejected</h1>
            <p>Dear ${agent.firstName} ${agent.lastName},</p>
            <p>Unfortunately, your property listing has been rejected.</p>
          </div>
          
          <div class="property-details">
            <h2>Property Details</h2>
            <p><strong>Title:</strong> ${property.title}</p>
            <p><strong>Location:</strong> ${property.location?.address || 'N/A'}, ${property.location?.city || 'N/A'}</p>
            
            ${reason ? `
            <div class="reason-box">
              <h3>Rejection Reason:</h3>
              <p>${reason}</p>
            </div>
            ` : ''}
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL}/agent/properties/${property._id}" class="button">Edit Property</a>
            </div>
            
            <p>Please review the feedback above and make the necessary changes. You can resubmit the property for approval after making corrections.</p>
            
            <p>Best regards,<br>
            ${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generatePropertyRejectionText(property, agent, agency, reason) {
    return `
Property Rejected

Dear ${agent.firstName} ${agent.lastName},

Unfortunately, your property listing has been rejected.

Property Details:
- Title: ${property.title}
- Location: ${property.location?.address || 'N/A'}, ${property.location?.city || 'N/A'}

${reason ? `Rejection Reason:\n${reason}\n` : ''}

Edit property: ${process.env.CLIENT_URL}/agent/properties/${property._id}

Please review the feedback above and make the necessary changes. You can resubmit the property for approval after making corrections.

Best regards,
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  async sendFollowUpReminder(lead, agent, agency) {
    try {
      if (!agent || !agent.email) {
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: agent.email,
        subject: `Follow-up Reminder: ${lead.contact.firstName} ${lead.contact.lastName}`,
        html: this.generateFollowUpReminderHTML(lead, agent, agency),
        text: this.generateFollowUpReminderText(lead, agent, agency)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Follow-up reminder email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending follow-up reminder email:', error);
      throw error;
    }
  }

  async sendTaskReminder(lead, agent, agency, tasks) {
    try {
      if (!agent || !agent.email) {
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: agent.email,
        subject: `Task Reminder: ${tasks.length} task(s) due for ${lead.contact.firstName} ${lead.contact.lastName}`,
        html: this.generateTaskReminderHTML(lead, agent, agency, tasks),
        text: this.generateTaskReminderText(lead, agent, agency, tasks)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Task reminder email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending task reminder email:', error);
      throw error;
    }
  }

  generateFollowUpReminderHTML(lead, agent, agency) {
    const followUpDate = lead.followUpDate ? new Date(lead.followUpDate).toLocaleDateString() : 'Today';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Follow-up Reminder</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #fff3cd; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
          .lead-details { background: #fff; border: 1px solid #ddd; padding: 20px; border-radius: 5px; }
          .button { display: inline-block; background: #2c5aa0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⏰ Follow-up Reminder</h1>
            <p>Dear ${agent.firstName} ${agent.lastName},</p>
            <p>You have a follow-up scheduled for <strong>${followUpDate}</strong>.</p>
          </div>
          
          <div class="lead-details">
            <h2>Lead Information</h2>
            <p><strong>Name:</strong> ${lead.contact.firstName} ${lead.contact.lastName}</p>
            <p><strong>Email:</strong> ${lead.contact.email}</p>
            <p><strong>Phone:</strong> ${lead.contact.phone}</p>
            <p><strong>Status:</strong> ${lead.status}</p>
            <p><strong>Follow-up Date:</strong> ${followUpDate}</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL}/agency/leads/${lead._id}" class="button">View Lead Details</a>
            </div>
            
            <p>Best regards,<br>
            ${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateFollowUpReminderText(lead, agent, agency) {
    const followUpDate = lead.followUpDate ? new Date(lead.followUpDate).toLocaleDateString() : 'Today';

    return `
Follow-up Reminder

Dear ${agent.firstName} ${agent.lastName},

You have a follow-up scheduled for ${followUpDate}.

Lead Information:
- Name: ${lead.contact.firstName} ${lead.contact.lastName}
- Email: ${lead.contact.email}
- Phone: ${lead.contact.phone}
- Status: ${lead.status}
- Follow-up Date: ${followUpDate}

View lead details: ${process.env.CLIENT_URL}/agency/leads/${lead._id}

Best regards,
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  generateTaskReminderHTML(lead, agent, agency, tasks) {
    const tasksList = tasks.map(task => `
      <li>
        <strong>${task.title}</strong>
        ${task.description ? `<br>${task.description}` : ''}
        <br><small>Due: ${new Date(task.dueDate).toLocaleDateString()}</small>
      </li>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Task Reminder</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #fff3cd; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
          .lead-details { background: #fff; border: 1px solid #ddd; padding: 20px; border-radius: 5px; }
          .tasks-list { list-style: none; padding: 0; }
          .tasks-list li { background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 5px; border-left: 4px solid #ffc107; }
          .button { display: inline-block; background: #2c5aa0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📋 Task Reminder</h1>
            <p>Dear ${agent.firstName} ${agent.lastName},</p>
            <p>You have <strong>${tasks.length}</strong> task(s) due for the following lead.</p>
          </div>
          
          <div class="lead-details">
            <h2>Lead Information</h2>
            <p><strong>Name:</strong> ${lead.contact.firstName} ${lead.contact.lastName}</p>
            <p><strong>Email:</strong> ${lead.contact.email}</p>
            <p><strong>Phone:</strong> ${lead.contact.phone}</p>
            
            <h3>Due Tasks:</h3>
            <ul class="tasks-list">
              ${tasksList}
            </ul>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL}/agency/leads/${lead._id}" class="button">View Lead & Tasks</a>
            </div>
            
            <p>Best regards,<br>
            ${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateTaskReminderText(lead, agent, agency, tasks) {
    const tasksList = tasks.map(task =>
      `- ${task.title} (Due: ${new Date(task.dueDate).toLocaleDateString()})`
    ).join('\n');

    return `
Task Reminder

Dear ${agent.firstName} ${agent.lastName},

You have ${tasks.length} task(s) due for the following lead.

Lead Information:
- Name: ${lead.contact.firstName} ${lead.contact.lastName}
- Email: ${lead.contact.email}
- Phone: ${lead.contact.phone}

Due Tasks:
${tasksList}

View lead & tasks: ${process.env.CLIENT_URL}/agency/leads/${lead._id}

Best regards,
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  async sendSiteVisitConfirmation(lead, relationshipManager, agency) {
    try {
      if (!lead || !lead.contact.email) {
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: lead.contact.email,
        subject: `Site Visit Confirmation - ${agency?.name || 'SPIRELEAP'}`,
        html: this.generateSiteVisitConfirmationHTML(lead, relationshipManager, agency),
        text: this.generateSiteVisitConfirmationText(lead, relationshipManager, agency)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Site visit confirmation email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending site visit confirmation email:', error);
      throw error;
    }
  }

  generateSiteVisitConfirmationHTML(lead, relationshipManager, agency) {
    const visitDate = lead.siteVisit?.scheduledDate
      ? new Date(lead.siteVisit.scheduledDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
      : 'TBD';
    const visitTime = lead.siteVisit?.scheduledTime || 'TBD';
    const rmName = relationshipManager
      ? `${relationshipManager.firstName} ${relationshipManager.lastName}`
      : 'Our team';
    const rmPhone = relationshipManager?.phone || '';
    const propertyName = lead.property?.title || 'Property';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .details { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #4F46E5; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Site Visit Confirmation</h1>
          </div>
          <div class="content">
            <p>Dear ${lead.contact.firstName} ${lead.contact.lastName},</p>
            
            <p>Thank you for your interest! We are pleased to confirm your site visit appointment.</p>
            
            <div class="details">
              <h3>Visit Details:</h3>
              <p><strong>Date:</strong> ${visitDate}</p>
              <p><strong>Time:</strong> ${visitTime}</p>
              <p><strong>Property:</strong> ${propertyName}</p>
              <p><strong>Relationship Manager:</strong> ${rmName}</p>
              ${rmPhone ? `<p><strong>Contact:</strong> ${rmPhone}</p>` : ''}
            </div>
            
            <p>We look forward to meeting you and showing you the property. If you need to reschedule or have any questions, please contact us at your earliest convenience.</p>
            
            <p>Best regards,<br>
            ${rmName}<br>
            ${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
          <div class="footer">
            <p>This is an automated confirmation email. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateSiteVisitConfirmationText(lead, relationshipManager, agency) {
    const visitDate = lead.siteVisit?.scheduledDate
      ? new Date(lead.siteVisit.scheduledDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
      : 'TBD';
    const visitTime = lead.siteVisit?.scheduledTime || 'TBD';
    const rmName = relationshipManager
      ? `${relationshipManager.firstName} ${relationshipManager.lastName}`
      : 'Our team';
    const rmPhone = relationshipManager?.phone || '';
    const propertyName = lead.property?.title || 'Property';

    return `
Site Visit Confirmation

Dear ${lead.contact.firstName} ${lead.contact.lastName},

Thank you for your interest! We are pleased to confirm your site visit appointment.

Visit Details:
- Date: ${visitDate}
- Time: ${visitTime}
- Property: ${propertyName}
- Relationship Manager: ${rmName}
${rmPhone ? `- Contact: ${rmPhone}` : ''}

We look forward to meeting you and showing you the property. If you need to reschedule or have any questions, please contact us at your earliest convenience.

Best regards,
${rmName}
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  async sendSiteVisitNotificationToAgent(lead, agent, agency) {
    try {
      if (!agent || !agent.email) {
        console.log('Agent email not available for site visit notification');
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: agent.email,
        subject: `Site Visit Scheduled - ${lead.contact.firstName} ${lead.contact.lastName}`,
        html: this.generateSiteVisitAgentNotificationHTML(lead, agent, agency),
        text: this.generateSiteVisitAgentNotificationText(lead, agent, agency)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Site visit notification email sent to agent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending site visit notification email to agent:', error);
      throw error;
    }
  }

  generateSiteVisitAgentNotificationHTML(lead, agent, agency) {
    const visitDate = lead.siteVisit?.scheduledDate
      ? new Date(lead.siteVisit.scheduledDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
      : 'TBD';
    const visitTime = lead.siteVisit?.scheduledTime || 'TBD';
    const propertyName = lead.property?.title || 'Property';
    const leadName = `${lead.contact.firstName} ${lead.contact.lastName}`;
    const leadPhone = lead.contact.phone || 'N/A';
    const leadEmail = lead.contact.email || 'N/A';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .details { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #4F46E5; }
          .lead-info { background-color: #f0f9ff; padding: 15px; margin: 15px 0; border-radius: 5px; }
          .button { display: inline-block; background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Site Visit Scheduled</h1>
          </div>
          <div class="content">
            <p>Dear ${agent.firstName} ${agent.lastName},</p>
            
            <p>A site visit has been scheduled for one of your assigned leads.</p>
            
            <div class="details">
              <h3>Visit Details:</h3>
              <p><strong>Date:</strong> ${visitDate}</p>
              <p><strong>Time:</strong> ${visitTime}</p>
              <p><strong>Property:</strong> ${propertyName}</p>
            </div>
            
            <div class="lead-info">
              <h3>Lead Information:</h3>
              <p><strong>Name:</strong> ${leadName}</p>
              <p><strong>Phone:</strong> ${leadPhone}</p>
              <p><strong>Email:</strong> ${leadEmail}</p>
              ${lead.inquiry?.message ? `<p><strong>Message:</strong> ${lead.inquiry.message}</p>` : ''}
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL}/agency/leads/${lead._id}" class="button">View Lead Details</a>
            </div>
            
            <p>Please prepare for the site visit and ensure you have all necessary information ready.</p>
            
            <p>Best regards,<br>
            ${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
          <div class="footer">
            <p>This is an automated notification. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateSiteVisitAgentNotificationText(lead, agent, agency) {
    const visitDate = lead.siteVisit?.scheduledDate
      ? new Date(lead.siteVisit.scheduledDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
      : 'TBD';
    const visitTime = lead.siteVisit?.scheduledTime || 'TBD';
    const propertyName = lead.property?.title || 'Property';
    const leadName = `${lead.contact.firstName} ${lead.contact.lastName}`;

    return `
Site Visit Scheduled

Dear ${agent.firstName} ${agent.lastName},

A site visit has been scheduled for one of your assigned leads.

Visit Details:
- Date: ${visitDate}
- Time: ${visitTime}
- Property: ${propertyName}

Lead Information:
- Name: ${leadName}
- Phone: ${lead.contact.phone || 'N/A'}
- Email: ${lead.contact.email || 'N/A'}
${lead.inquiry?.message ? `- Message: ${lead.inquiry.message}` : ''}

View lead details: ${process.env.CLIENT_URL}/agency/leads/${lead._id}

Please prepare for the site visit and ensure you have all necessary information ready.

Best regards,
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  async sendSiteVisitReminder(lead, relationshipManager, agency) {
    try {
      if (!relationshipManager || !relationshipManager.email) {
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: relationshipManager.email,
        subject: `Site Visit Reminder - ${lead.contact.firstName} ${lead.contact.lastName}`,
        html: this.generateSiteVisitReminderHTML(lead, relationshipManager, agency),
        text: this.generateSiteVisitReminderText(lead, relationshipManager, agency)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Site visit reminder email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending site visit reminder email:', error);
      throw error;
    }
  }

  generateSiteVisitReminderHTML(lead, relationshipManager, agency) {
    const visitDate = lead.siteVisit?.scheduledDate
      ? new Date(lead.siteVisit.scheduledDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
      : 'TBD';
    const visitTime = lead.siteVisit?.scheduledTime || 'TBD';
    const propertyName = lead.property?.title || 'Property';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #F59E0B; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .details { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #F59E0B; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Site Visit Reminder</h1>
          </div>
          <div class="content">
            <p>Dear ${relationshipManager.firstName} ${relationshipManager.lastName},</p>
            
            <p>This is a reminder about your upcoming site visit appointment.</p>
            
            <div class="details">
              <h3>Visit Details:</h3>
              <p><strong>Date:</strong> ${visitDate}</p>
              <p><strong>Time:</strong> ${visitTime}</p>
              <p><strong>Lead:</strong> ${lead.contact.firstName} ${lead.contact.lastName}</p>
              <p><strong>Contact:</strong> ${lead.contact.phone} | ${lead.contact.email}</p>
              <p><strong>Property:</strong> ${propertyName}</p>
            </div>
            
            <p>Please ensure you are prepared for the visit and have all necessary materials ready.</p>
            
            <p>Best regards,<br>
            ${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
          <div class="footer">
            <p>This is an automated reminder email.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateSiteVisitReminderText(lead, relationshipManager, agency) {
    const visitDate = lead.siteVisit?.scheduledDate
      ? new Date(lead.siteVisit.scheduledDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
      : 'TBD';
    const visitTime = lead.siteVisit?.scheduledTime || 'TBD';
    const propertyName = lead.property?.title || 'Property';

    return `
Site Visit Reminder

Dear ${relationshipManager.firstName} ${relationshipManager.lastName},

This is a reminder about your upcoming site visit appointment.

Visit Details:
- Date: ${visitDate}
- Time: ${visitTime}
- Lead: ${lead.contact.firstName} ${lead.contact.lastName}
- Contact: ${lead.contact.phone} | ${lead.contact.email}
- Property: ${propertyName}

Please ensure you are prepared for the visit and have all necessary materials ready.

Best regards,
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  async sendFollowUpReminder(lead, agent, agency) {
    try {
      if (!agent || !agent.email) {
        console.log('Agent email not available for follow-up reminder');
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: agent.email,
        subject: `Follow-Up Reminder - ${lead.contact.firstName} ${lead.contact.lastName}`,
        html: this.generateFollowUpReminderHTML(lead, agent, agency),
        text: this.generateFollowUpReminderText(lead, agent, agency)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Follow-up reminder email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending follow-up reminder email:', error);
      throw error;
    }
  }

  generateFollowUpReminderHTML(lead, agent, agency) {
    const followUpDate = lead.followUpDate
      ? new Date(lead.followUpDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
      : 'TBD';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #F59E0B; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .details { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #F59E0B; }
          .button { display: inline-block; background: #F59E0B; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Follow-Up Reminder</h1>
          </div>
          <div class="content">
            <p>Dear ${agent.firstName} ${agent.lastName},</p>
            <p>This is a reminder to follow up with a lead assigned to you.</p>
            <div class="details">
              <h3>Lead Information:</h3>
              <p><strong>Lead ID:</strong> ${lead.leadId}</p>
              <p><strong>Name:</strong> ${lead.contact.firstName} ${lead.contact.lastName}</p>
              <p><strong>Phone:</strong> ${lead.contact.phone}</p>
              <p><strong>Email:</strong> ${lead.contact.email}</p>
              <p><strong>Follow-Up Date:</strong> ${followUpDate}</p>
              <p><strong>Status:</strong> ${lead.status}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL}/agency/leads/${lead._id}" class="button">View Lead Details</a>
            </div>
            <p>Best regards,<br>${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateFollowUpReminderText(lead, agent, agency) {
    const followUpDate = lead.followUpDate
      ? new Date(lead.followUpDate).toLocaleDateString()
      : 'TBD';

    return `
Follow-Up Reminder

Dear ${agent.firstName} ${agent.lastName},

This is a reminder to follow up with a lead assigned to you.

Lead Information:
- Lead ID: ${lead.leadId}
- Name: ${lead.contact.firstName} ${lead.contact.lastName}
- Phone: ${lead.contact.phone}
- Email: ${lead.contact.email}
- Follow-Up Date: ${followUpDate}
- Status: ${lead.status}

View lead details: ${process.env.CLIENT_URL}/agency/leads/${lead._id}

Best regards,
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  async sendTaskReminder(lead, agent, agency, tasks) {
    try {
      if (!agent || !agent.email) {
        console.log('Agent email not available for task reminder');
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: agent.email,
        subject: `Task Reminder - ${tasks.length} task(s) due`,
        html: this.generateTaskReminderHTML(lead, agent, agency, tasks),
        text: this.generateTaskReminderText(lead, agent, agency, tasks)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Task reminder email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending task reminder email:', error);
      throw error;
    }
  }

  generateTaskReminderHTML(lead, agent, agency, tasks) {
    const tasksList = tasks.map(task => `
      <li>
        <strong>${task.title}</strong><br>
        Due: ${new Date(task.dueDate).toLocaleDateString()}<br>
        Status: ${task.status}
      </li>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #8B5CF6; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .button { display: inline-block; background: #8B5CF6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Task Reminder</h1>
          </div>
          <div class="content">
            <p>Dear ${agent.firstName} ${agent.lastName},</p>
            <p>You have ${tasks.length} task(s) due for lead ${lead.leadId}: ${lead.contact.firstName} ${lead.contact.lastName}</p>
            <ul>${tasksList}</ul>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL}/agency/leads/${lead._id}" class="button">View Lead Details</a>
            </div>
            <p>Best regards,<br>${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateTaskReminderText(lead, agent, agency, tasks) {
    const tasksList = tasks.map(task =>
      `- ${task.title} (Due: ${new Date(task.dueDate).toLocaleDateString()}, Status: ${task.status})`
    ).join('\n');

    return `
Task Reminder

Dear ${agent.firstName} ${agent.lastName},

You have ${tasks.length} task(s) due for lead ${lead.leadId}: ${lead.contact.firstName} ${lead.contact.lastName}

Tasks:
${tasksList}

View lead details: ${process.env.CLIENT_URL}/agency/leads/${lead._id}

Best regards,
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  async sendSiteVisitReminder(lead, relationshipManager, agency) {
    try {
      if (!relationshipManager || !relationshipManager.email) {
        console.log('Relationship manager email not available for site visit reminder');
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: relationshipManager.email,
        subject: `Site Visit Reminder - ${lead.contact.firstName} ${lead.contact.lastName}`,
        html: this.generateSiteVisitReminderHTML(lead, relationshipManager, agency),
        text: this.generateSiteVisitReminderText(lead, relationshipManager, agency)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Site visit reminder email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending site visit reminder email:', error);
      throw error;
    }
  }

  generateSiteVisitReminderHTML(lead, relationshipManager, agency) {
    const visitDate = lead.siteVisit?.scheduledDate
      ? new Date(lead.siteVisit.scheduledDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
      : 'TBD';
    const visitTime = lead.siteVisit?.scheduledTime || 'TBD';
    const propertyName = lead.property?.title || 'Property';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #10B981; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .details { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #10B981; }
          .button { display: inline-block; background: #10B981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Site Visit Reminder</h1>
          </div>
          <div class="content">
            <p>Dear ${relationshipManager.firstName} ${relationshipManager.lastName},</p>
            <p>This is a reminder about your upcoming site visit appointment.</p>
            <div class="details">
              <h3>Visit Details:</h3>
              <p><strong>Date:</strong> ${visitDate}</p>
              <p><strong>Time:</strong> ${visitTime}</p>
              <p><strong>Lead:</strong> ${lead.contact.firstName} ${lead.contact.lastName}</p>
              <p><strong>Contact:</strong> ${lead.contact.phone} | ${lead.contact.email}</p>
              <p><strong>Property:</strong> ${propertyName}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL}/agency/leads/${lead._id}" class="button">View Lead Details</a>
            </div>
            <p>Please ensure you are prepared for the visit and have all necessary materials ready.</p>
            <p>Best regards,<br>${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async sendMissedFollowUpAlert(lead, agent, agency, daysOverdue) {
    try {
      if (!agent || !agent.email) {
        console.log('Agent email not available for missed follow-up alert');
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: agent.email,
        subject: `⚠️ MISSED FOLLOW-UP ALERT - ${daysOverdue} day(s) overdue - ${lead.leadId}`,
        html: this.generateMissedFollowUpAlertHTML(lead, agent, agency, daysOverdue),
        text: this.generateMissedFollowUpAlertText(lead, agent, agency, daysOverdue)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Missed follow-up alert email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending missed follow-up alert email:', error);
      throw error;
    }
  }

  generateMissedFollowUpAlertHTML(lead, agent, agency, daysOverdue) {
    const followUpDate = lead.followUpDate
      ? new Date(lead.followUpDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
      : 'TBD';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #EF4444; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .alert { background-color: #FEE2E2; border-left: 4px solid #EF4444; padding: 15px; margin: 15px 0; }
          .details { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #EF4444; }
          .button { display: inline-block; background: #EF4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⚠️ MISSED FOLLOW-UP ALERT</h1>
          </div>
          <div class="content">
            <div class="alert">
              <h2 style="margin-top: 0; color: #EF4444;">This follow-up is ${daysOverdue} day(s) overdue!</h2>
              <p><strong>Action Required:</strong> Please follow up with this lead immediately.</p>
            </div>
            <p>Dear ${agent.firstName} ${agent.lastName},</p>
            <p>You have a missed follow-up that requires immediate attention.</p>
            <div class="details">
              <h3>Lead Information:</h3>
              <p><strong>Lead ID:</strong> ${lead.leadId}</p>
              <p><strong>Name:</strong> ${lead.contact.firstName} ${lead.contact.lastName}</p>
              <p><strong>Phone:</strong> ${lead.contact.phone}</p>
              <p><strong>Email:</strong> ${lead.contact.email}</p>
              <p><strong>Follow-Up Date:</strong> ${followUpDate}</p>
              <p><strong>Days Overdue:</strong> ${daysOverdue} day(s)</p>
              <p><strong>Status:</strong> ${lead.status}</p>
              <p><strong>Priority:</strong> ${lead.priority}</p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL}/agency/leads/${lead._id}" class="button">View Lead & Follow Up Now</a>
            </div>
            <p><strong>Please contact this lead as soon as possible to avoid further delays.</strong></p>
            <p>Best regards,<br>${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateMissedFollowUpAlertText(lead, agent, agency, daysOverdue) {
    const followUpDate = lead.followUpDate
      ? new Date(lead.followUpDate).toLocaleDateString()
      : 'TBD';

    return `
⚠️ MISSED FOLLOW-UP ALERT

Dear ${agent.firstName} ${agent.lastName},

This follow-up is ${daysOverdue} day(s) overdue! Action Required: Please follow up with this lead immediately.

Lead Information:
- Lead ID: ${lead.leadId}
- Name: ${lead.contact.firstName} ${lead.contact.lastName}
- Phone: ${lead.contact.phone}
- Email: ${lead.contact.email}
- Follow-Up Date: ${followUpDate}
- Days Overdue: ${daysOverdue} day(s)
- Status: ${lead.status}
- Priority: ${lead.priority}

View lead details: ${process.env.CLIENT_URL}/agency/leads/${lead._id}

Please contact this lead as soon as possible to avoid further delays.

Best regards,
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  async sendMissedFollowUpAlertToManager(lead, agent, manager, agency, daysOverdue) {
    try {
      if (!manager || !manager.email) {
        console.log('Manager email not available for missed follow-up alert');
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: manager.email,
        subject: `⚠️ Team Member Missed Follow-Up - ${lead.leadId} (${daysOverdue} days overdue)`,
        html: this.generateMissedFollowUpManagerAlertHTML(lead, agent, manager, agency, daysOverdue),
        text: this.generateMissedFollowUpManagerAlertText(lead, agent, manager, agency, daysOverdue)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Missed follow-up alert email sent to manager:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending missed follow-up alert email to manager:', error);
      throw error;
    }
  }

  generateMissedFollowUpManagerAlertHTML(lead, agent, manager, agency, daysOverdue) {
    const followUpDate = lead.followUpDate
      ? new Date(lead.followUpDate).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
      : 'TBD';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #F59E0B; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .alert { background-color: #FEF3C7; border-left: 4px solid #F59E0B; padding: 15px; margin: 15px 0; }
          .details { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #F59E0B; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Team Member Missed Follow-Up</h1>
          </div>
          <div class="content">
            <div class="alert">
              <p><strong>Alert:</strong> One of your team members has a missed follow-up that is ${daysOverdue} day(s) overdue.</p>
            </div>
            <p>Dear ${manager.firstName} ${manager.lastName},</p>
            <div class="details">
              <h3>Lead Information:</h3>
              <p><strong>Lead ID:</strong> ${lead.leadId}</p>
              <p><strong>Name:</strong> ${lead.contact.firstName} ${lead.contact.lastName}</p>
              <p><strong>Phone:</strong> ${lead.contact.phone}</p>
              <p><strong>Email:</strong> ${lead.contact.email}</p>
              <p><strong>Follow-Up Date:</strong> ${followUpDate}</p>
              <p><strong>Days Overdue:</strong> ${daysOverdue} day(s)</p>
              <h3>Assigned Agent:</h3>
              <p><strong>Name:</strong> ${agent.firstName} ${agent.lastName}</p>
              <p><strong>Email:</strong> ${agent.email}</p>
            </div>
            <p>Please ensure your team member follows up with this lead immediately.</p>
            <p>Best regards,<br>${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateMissedFollowUpManagerAlertText(lead, agent, manager, agency, daysOverdue) {
    const followUpDate = lead.followUpDate
      ? new Date(lead.followUpDate).toLocaleDateString()
      : 'TBD';

    return `
Team Member Missed Follow-Up

Dear ${manager.firstName} ${manager.lastName},

Alert: One of your team members has a missed follow-up that is ${daysOverdue} day(s) overdue.

Lead Information:
- Lead ID: ${lead.leadId}
- Name: ${lead.contact.firstName} ${lead.contact.lastName}
- Phone: ${lead.contact.phone}
- Email: ${lead.contact.email}
- Follow-Up Date: ${followUpDate}
- Days Overdue: ${daysOverdue} day(s)

Assigned Agent:
- Name: ${agent.firstName} ${agent.lastName}
- Email: ${agent.email}

Please ensure your team member follows up with this lead immediately.

Best regards,
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  async sendMissedTaskAlert(lead, agent, agency, tasks, daysOverdue) {
    try {
      if (!agent || !agent.email) {
        console.log('Agent email not available for missed task alert');
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: agent.email,
        subject: `⚠️ MISSED TASK ALERT - ${tasks.length} task(s) overdue - ${lead.leadId}`,
        html: this.generateMissedTaskAlertHTML(lead, agent, agency, tasks, daysOverdue),
        text: this.generateMissedTaskAlertText(lead, agent, agency, tasks, daysOverdue)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Missed task alert email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending missed task alert email:', error);
      throw error;
    }
  }

  generateMissedTaskAlertHTML(lead, agent, agency, tasks, daysOverdue) {
    const tasksList = tasks.map(task => {
      const taskDaysOverdue = Math.floor((new Date() - new Date(task.dueDate)) / (1000 * 60 * 60 * 24));
      return `
        <li>
          <strong>${task.title}</strong><br>
          Due: ${new Date(task.dueDate).toLocaleDateString()}<br>
          Overdue: ${taskDaysOverdue} day(s)<br>
          Status: ${task.status}
        </li>
      `;
    }).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #EF4444; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .alert { background-color: #FEE2E2; border-left: 4px solid #EF4444; padding: 15px; margin: 15px 0; }
          .button { display: inline-block; background: #EF4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⚠️ MISSED TASK ALERT</h1>
          </div>
          <div class="content">
            <div class="alert">
              <h2 style="margin-top: 0; color: #EF4444;">You have ${tasks.length} overdue task(s)!</h2>
            </div>
            <p>Dear ${agent.firstName} ${agent.lastName},</p>
            <p>You have missed tasks for lead ${lead.leadId}: ${lead.contact.firstName} ${lead.contact.lastName}</p>
            <ul>${tasksList}</ul>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL}/agency/leads/${lead._id}" class="button">View Lead & Complete Tasks</a>
            </div>
            <p>Best regards,<br>${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateMissedTaskAlertText(lead, agent, agency, tasks, daysOverdue) {
    const tasksList = tasks.map(task => {
      const taskDaysOverdue = Math.floor((new Date() - new Date(task.dueDate)) / (1000 * 60 * 60 * 24));
      return `- ${task.title} (Due: ${new Date(task.dueDate).toLocaleDateString()}, Overdue: ${taskDaysOverdue} day(s), Status: ${task.status})`;
    }).join('\n');

    return `
⚠️ MISSED TASK ALERT

Dear ${agent.firstName} ${agent.lastName},

You have ${tasks.length} overdue task(s) for lead ${lead.leadId}: ${lead.contact.firstName} ${lead.contact.lastName}

Tasks:
${tasksList}

View lead details: ${process.env.CLIENT_URL}/agency/leads/${lead._id}

Best regards,
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  async sendBulkLeadNotification(lead, agency, recipients) {
    try {
      if (!recipients || recipients.length === 0) {
        console.log('No recipients available for lead notification');
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: recipients.join(','),
        subject: `New Property Enquiry: ${lead.contact.firstName} ${lead.contact.lastName}`,
        html: this.generateLeadNotificationHTML(lead, { firstName: 'Admin', lastName: '' }, agency),
        text: this.generateLeadNotificationText(lead, { firstName: 'Admin', lastName: '' }, agency)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Bulk lead notification email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending bulk lead notification email:', error);
      throw error;
    }
  }

  async sendContactMessageNotification(message, agency, recipients) {
    try {
      if (!recipients || recipients.length === 0) {
        console.log('No recipients available for contact message notification');
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: recipients.join(','),
        subject: `New Contact Enquiry: ${message.name}`,
        html: this.generateContactMessageNotificationHTML(message, agency),
        text: this.generateContactMessageNotificationText(message, agency)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('Contact message notification email sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending contact message notification email:', error);
      throw error;
    }
  }

  generateContactMessageNotificationHTML(message, agency) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>New Contact Enquiry</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px; border-left: 4px solid #2c5aa0; }
          .details { background: #fff; border: 1px solid #ddd; padding: 20px; border-radius: 5px; }
          .message-box { background: #f4f4f4; padding: 15px; border-radius: 5px; margin: 15px 0; font-style: italic; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">New Contact Enquiry</h1>
            <p>A new visitor has submitted a contact form on your website.</p>
          </div>
          <div class="details">
            <h2 style="color: #2c5aa0; border-bottom: 1px solid #eee; padding-bottom: 10px;">Visitor Details</h2>
            <p><strong>Name:</strong> ${message.name}</p>
            <p><strong>Email:</strong> ${message.email}</p>
            <p><strong>Phone:</strong> ${message.phone || 'N/A'}</p>
            <p><strong>Subject:</strong> ${message.subject || 'N/A'}</p>
            <p><strong>Message:</strong></p>
            <div class="message-box">
              ${message.message}
            </div>
            <p><strong>Agency:</strong> ${agency?.name || 'N/A'}</p>
          </div>
          <p style="text-align: center; color: #666; font-size: 12px; margin-top: 30px;">
            Best regards,<br>
            <strong>${agency?.name || 'SPIRELEAP'} Team</strong>
          </p>
        </div>
      </body>
      </html>
    `;
  }

  generateContactMessageNotificationText(message, agency) {
    return `
New Contact Enquiry

A new visitor has submitted a contact form on your website.

Visitor Details:
- Name: ${message.name}
- Email: ${message.email}
- Phone: ${message.phone || 'N/A'}
- Subject: ${message.subject || 'N/A'}
- Message: ${message.message}
- Agency: ${agency?.name || 'N/A'}

Best regards,
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  async sendNewPropertyNotificationToAdmin(property, agent, agency, recipients) {
    try {
      if (!recipients || recipients.length === 0) {
        console.log('No recipients available for new property notification');
        return null;
      }

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: recipients.join(','),
        subject: `New Property Listing Added: ${property.title}`,
        html: this.generateNewPropertyListingHTML(property, agent, agency),
        text: this.generateNewPropertyListingText(property, agent, agency)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('New property listing notification sent:', result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending new property listing notification:', error);
      throw error;
    }
  }

  generateNewPropertyListingHTML(property, agent, agency) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>New Property Listing Added</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #eef2f7; padding: 20px; border-radius: 5px; margin-bottom: 20px; border-left: 4px solid #2c5aa0; }
          .property-details { background: #fff; border: 1px solid #ddd; padding: 20px; border-radius: 5px; }
          .button { display: inline-block; background: #2c5aa0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">New Property Listing</h1>
            <p>An agent has added a new property listing that requires your review.</p>
          </div>
          
          <div class="property-details">
            <h2>Listing Information</h2>
            <p><strong>Title:</strong> ${property.title}</p>
            <p><strong>Agent:</strong> ${agent.firstName || ''} ${agent.lastName || ''}</p>
            <p><strong>Property Type:</strong> ${property.propertyType}</p>
            <p><strong>Listing Type:</strong> ${property.listingType}</p>
            <p><strong>Location:</strong> ${property.location?.address || 'N/A'}, ${property.location?.city || 'N/A'}</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.CLIENT_URL}/agency/properties/${property._id}" class="button">Review Property</a>
            </div>
            
            <p>Best regards,<br>
            ${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generateNewPropertyListingText(property, agent, agency) {
    return `
New Property Listing Added

An agent has added a new property listing that requires your review.

Listing Information:
- Title: ${property.title}
- Agent: ${agent.firstName || ''} ${agent.lastName || ''}
- Property Type: ${property.propertyType}
- Listing Type: ${property.listingType}
- Location: ${property.location?.address || 'N/A'}, ${property.location?.city || 'N/A'}

Review Property: ${process.env.CLIENT_URL}/agency/properties/${property._id}

Best regards,
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  async sendPropertyStatusUpdateNotification(property, agent, agency, recipients, newStatus) {
    try {
      if (!recipients || recipients.length === 0) {
        return null;
      }

      const statusLabels = {
        'sold': 'SOLD',
        'rented': 'RENTED',
        'unavailable': 'UNAVAILABLE',
        'inactive': 'UNAVAILABLE'
      };

      const label = statusLabels[newStatus] || newStatus.toUpperCase();

      const mailOptions = {
        from: `"${agency?.name || 'SPIRELEAP'}" <${process.env.SMTP_USER}>`,
        to: recipients.join(','),
        subject: `Property Status Updated to ${label}: ${property.title}`,
        html: this.generatePropertyStatusUpdateHTML(property, agent, agency, label),
        text: this.generatePropertyStatusUpdateText(property, agent, agency, label)
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(`Property status update notification (${label}) sent:`, result.messageId);
      return result;
    } catch (error) {
      console.error('Error sending property status update notification:', error);
      throw error;
    }
  }

  generatePropertyStatusUpdateHTML(property, agent, agency, statusLabel) {
    const color = statusLabel === 'SOLD' ? '#d32f2f' : statusLabel === 'RENTED' ? '#2e7d32' : '#757575';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Property Status Updated: ${statusLabel}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f4f6f8; padding: 20px; border-radius: 5px; margin-bottom: 20px; border-left: 4px solid ${color}; }
          .property-details { background: #fff; border: 1px solid #ddd; padding: 20px; border-radius: 5px; }
          .badge { display: inline-block; background: ${color}; color: white; padding: 5px 12px; border-radius: 4px; font-weight: bold; text-transform: uppercase; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Property Status Update</h1>
            <p>The status of a property has been updated to <span class="badge">${statusLabel}</span>.</p>
          </div>
          
          <div class="property-details">
            <h2>Listing Information</h2>
            <p><strong>Title:</strong> ${property.title}</p>
            <p><strong>New Status:</strong> <span style="color: ${color}; font-weight: bold;">${statusLabel}</span></p>
            <p><strong>Agent:</strong> ${agent?.firstName || ''} ${agent?.lastName || ''}</p>
            <p><strong>Location:</strong> ${property.location?.address || 'N/A'}, ${property.location?.city || 'N/A'}</p>
            
            <p>This listing has been updated in the CRM.</p>
            
            <p>Best regards,<br>
            ${agency?.name || 'SPIRELEAP'} Team</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  generatePropertyStatusUpdateText(property, agent, agency, statusLabel) {
    return `
Property Status Update

The status of the following property has been updated to ${statusLabel}.

Listing Information:
- Title: ${property.title}
- New Status: ${statusLabel}
- Agent: ${agent?.firstName || ''} ${agent?.lastName || ''}
- Location: ${property.location?.address || 'N/A'}, ${property.location?.city || 'N/A'}

Best regards,
${agency?.name || 'SPIRELEAP'} Team
    `;
  }

  async sendPasswordChangeConfirmation(user) {
    try {
      const mailOptions = {
        from: `"SPIRELEAP Real Estate" <${process.env.SMTP_USER}>`,
        to: user.email,
        subject: 'Security Alert: Your Password Was Changed',
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-top: 4px solid #d32f2f; border-radius: 5px;">
            <h2 style="color: #d32f2f;">Security Alert</h2>
            <p>Dear ${user.firstName},</p>
            <p>This is a confirmation that the password for your SPIRELEAP CRM account was recently changed.</p>
            <p>If you made this change, you can safely ignore this email.</p>
            <p><strong>If you did NOT change your password</strong>, please contact your administrator immediately or use the "Forgot Password" link on the login page to secure your account.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 12px; color: #666;">This is an automated security notification. Please do not reply to this email.</p>
          </div>
        `,
        text: `Security Alert: Your password was recently changed. If you did not make this change, please contact your administrator immediately.`
      };

      const result = await this.transporter.sendMail(mailOptions);
      return result;
    } catch (error) {
      console.error('Error sending password change confirmation:', error);
    }
  }

  async sendProfileUpdateNotification(user) {
    try {
      const mailOptions = {
        from: `"SPIRELEAP Real Estate" <${process.env.SMTP_USER}>`,
        to: user.email,
        subject: 'Profile Information Updated',
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-top: 4px solid #2c5aa0; border-radius: 5px;">
            <h2 style="color: #2c5aa0;">Profile Updated</h2>
            <p>Dear ${user.firstName},</p>
            <p>Your profile information on SPIRELEAP CRM has been successfully updated.</p>
            <p>If you did not perform this action, please review your account settings or contact an administrator.</p>
            <p>Best regards,<br>SPIRELEAP team</p>
          </div>
        `,
        text: `Your profile information on SPIRELEAP CRM has been updated.`
      };

      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending profile update notification:', error);
    }
  }

  async sendRoleChangeNotification(user, oldRole, newRole) {
    try {
      const formatRole = (role) => role.replace('_', ' ').toUpperCase();
      const mailOptions = {
        from: `"SPIRELEAP Real Estate" <${process.env.SMTP_USER}>`,
        to: user.email,
        subject: 'Account Role Updated',
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-top: 4px solid #f39c12; border-radius: 5px;">
            <h2 style="color: #f39c12;">Role Updated</h2>
            <p>Dear ${user.firstName},</p>
            <p>Your account role in the SPIRELEAP CRM has been updated by an administrator.</p>
            <div style="background: #fdf2e9; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p style="margin: 0;"><strong>Previous Role:</strong> ${formatRole(oldRole)}</p>
              <p style="margin: 5px 0 0 0;"><strong>New Role:</strong> ${formatRole(newRole)}</p>
            </div>
            <p>Your permissions in the system have been adjusted accordingly. Please log out and log back in to see the changes.</p>
            <p>Best regards,<br>SPIRELEAP team</p>
          </div>
        `,
        text: `Your account role has been updated from ${oldRole} to ${newRole}. Please log out and log back in.`
      };

      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending role change notification:', error);
    }
  }
}

module.exports = new EmailService();

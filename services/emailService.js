const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
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
}

module.exports = new EmailService();

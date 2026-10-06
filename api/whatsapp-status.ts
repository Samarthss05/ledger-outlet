export default {
  fetch():Response {
    const configured = Boolean(process.env.SUPABASE_URL &&
      (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) &&
      process.env.OPENROUTER_API_KEY &&
      process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN &&
      process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_SHARED_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_GRAPH_VERSION && process.env.WHATSAPP_ORDER_TEMPLATE_NAME &&
      process.env.WHATSAPP_OWNER_ALERT_TEMPLATE_NAME);
    return Response.json({configured});
  }
};

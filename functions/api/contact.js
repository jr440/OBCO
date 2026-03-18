const json = (data, status = 200) => {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8"
        }
    });
};

const readPayload = async (request) => {
    try {
        return await request.json();
    } catch (_error) {
        return null;
    }
};

const safe = (value, fallback = "-") => {
    if (value === null || value === undefined) {
        return fallback;
    }
    const asString = String(value).trim();
    return asString ? asString : fallback;
};

const isEmail = (value) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
};

const verifyTurnstile = async ({ secret, token, ip }) => {
    const body = new URLSearchParams();
    body.append("secret", secret);
    body.append("response", token);
    if (ip) {
        body.append("remoteip", ip);
    }

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded"
        },
        body: body.toString()
    });

    if (!response.ok) {
        return { success: false, errors: ["siteverify-http-error"] };
    }

    const data = await response.json();
    return {
        success: Boolean(data.success),
        hostname: data.hostname || "",
        errors: Array.isArray(data["error-codes"]) ? data["error-codes"] : []
    };
};

const buildTextBody = ({ contact, submittedAt }) => {
    return [
        "New website enquiry",
        "",
        `Submitted at: ${safe(submittedAt)}`,
        `Service: ${safe(contact.service)}`,
        "",
        "Contact",
        `Name: ${safe(contact.fullName)}`,
        `Email: ${safe(contact.email)}`,
        `Phone: ${safe(contact.phone)}`,
        `Location: ${safe(contact.location)}`,
        `Deadline: ${safe(contact.deadline)}`,
        "",
        "Project Summary",
        safe(contact.message)
    ].join("\n");
};

const buildHtmlBody = ({ contact, submittedAt }) => {
    return `
        <h2>New website enquiry</h2>
        <p><strong>Submitted at:</strong> ${safe(submittedAt)}</p>
        <p><strong>Service:</strong> ${safe(contact.service)}</p>
        <h3>Contact</h3>
        <p><strong>Name:</strong> ${safe(contact.fullName)}<br>
        <strong>Email:</strong> ${safe(contact.email)}<br>
        <strong>Phone:</strong> ${safe(contact.phone)}<br>
        <strong>Location:</strong> ${safe(contact.location)}<br>
        <strong>Deadline:</strong> ${safe(contact.deadline)}</p>
        <h3>Project Summary</h3>
        <p>${safe(contact.message)}</p>
    `;
};

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            "allow": "POST, OPTIONS"
        }
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const payload = await readPayload(request);

    if (!payload || typeof payload !== "object") {
        return json({ error: "Invalid JSON payload." }, 400);
    }

    const contact = payload.contact || {};
    const turnstileToken = safe(payload.turnstileToken, "");
    const submittedAt = payload.submittedAt || new Date().toISOString();

    if (!safe(contact.fullName, "") || !isEmail(contact.email) || !safe(contact.message, "")) {
        return json({ error: "Valid name, email, and message are required." }, 400);
    }

    const turnstileSecret = env.TURNSTILE_SECRET_KEY;
    if (!turnstileSecret) {
        return json({ error: "TURNSTILE_SECRET_KEY is missing." }, 500);
    }

    if (!turnstileToken) {
        return json({ error: "Missing Turnstile token." }, 400);
    }

    const turnstileCheck = await verifyTurnstile({
        secret: turnstileSecret,
        token: turnstileToken,
        ip: request.headers.get("CF-Connecting-IP") || ""
    });

    if (!turnstileCheck.success) {
        return json({
            error: "Turnstile verification failed.",
            codes: turnstileCheck.errors
        }, 403);
    }

    const expectedHostname = safe(env.TURNSTILE_EXPECTED_HOSTNAME, "");
    if (expectedHostname && turnstileCheck.hostname && turnstileCheck.hostname !== expectedHostname) {
        return json({
            error: "Turnstile hostname mismatch.",
            hostname: turnstileCheck.hostname
        }, 403);
    }

    const resendApiKey = env.RESEND_API_KEY;
    const contactToEmail = safe(env.CONTACT_TO_EMAIL, safe(env.QUOTE_TO_EMAIL, ""));
    const contactFromEmail = safe(env.CONTACT_FROM_EMAIL, safe(env.QUOTE_FROM_EMAIL, ""));

    if (!resendApiKey || !contactToEmail || !contactFromEmail) {
        return json({
            error: "Email service is not configured. Missing RESEND_API_KEY and contact email settings."
        }, 500);
    }

    const subject = `Website Enquiry | ${safe(contact.service, "General")}`;
    const textBody = buildTextBody({ contact, submittedAt });
    const htmlBody = buildHtmlBody({ contact, submittedAt });

    const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: contactFromEmail,
            to: [contactToEmail],
            reply_to: contact.email,
            subject,
            text: textBody,
            html: htmlBody
        })
    });

    if (!resendResponse.ok) {
        const details = await resendResponse.text();
        return json({ error: "Failed to send email.", details }, 502);
    }

    return json({ ok: true, message: "Contact enquiry submitted successfully." }, 200);
}
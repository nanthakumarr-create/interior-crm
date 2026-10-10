# HubSpot private app (Aangan Enquiry Sync)

Static-auth private app that gives the engine a token with contacts + deals write scopes.

```bash
cd hubspot
hs project upload        # build + deploy (account: aangan, 247652821)
hs project install-app   # install into the account
```

Then copy the static access token from HubSpot (Development → Projects → aangan-crm-sync → app → Auth) into `HUBSPOT_ACCESS_TOKEN`.

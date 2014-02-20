Changelog
=========

**Version 0.12.0 - Feb 2, 2014**

Added new authentication methods: `linkedInSignup` and `gitHubSignup`. Both need two arguments. The first on is a credentials object with an `access_token`. And the second one is the callback that will receive `function(err, user, isNew)` like the facebook and twitter authentication methods.

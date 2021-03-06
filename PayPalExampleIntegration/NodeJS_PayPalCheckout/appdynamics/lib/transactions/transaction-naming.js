'use strict';


function TransactionNaming(agent) {
  this.agent = agent;

  this.namingProps = undefined;
}
exports.TransactionNaming = TransactionNaming;


TransactionNaming.prototype.init = function() {
	var self = this;

  self.agent.on('configUpdated', function() {
    var props = self.agent.configManager.getConfigValue('txConfig.nodejsWeb.discoveryConfig.namingScheme.properties');
    self.namingProps = self.agent.configManager.convertListToMap(props);

    // Headers are lowercased in Node.js
    if(self.namingProps['uri-suffix-scheme'] === 'header-value' && self.namingProps['suffix-key']) {
    	self.namingProps['suffix-key'] = self.namingProps['suffix-key'].toLowerCase();
    }
  });
}

TransactionNaming.prototype.createHttpTransactionName = function(req, transaction) {
    var matchName = transaction.customMatch && transaction.customMatch.btName
    ,   namingProps = transaction.customNaming || this.namingProps;

    return this.createHttpTransactionNameFromNamingScheme(req, namingProps, matchName);
}

TransactionNaming.prototype.createHttpTransactionName = function(req) {
  var self = this;

	var baseName = self.createWithUriSegments(req);

	var uriSuffixScheme = self.namingProps['uri-suffix-scheme'];
	var suffixKey = self.namingProps['suffix-key'];
	var delimiter = self.namingProps['delimiter'];
	delimiter = delimiter ? delimiter : "";

	if(!uriSuffixScheme || !suffixKey) {
		return baseName;
	}

	switch(uriSuffixScheme) {
		case 'uri-segment-number':
			baseName = self.transformUriSegments(req, baseName, suffixKey, delimiter);
			break;
		case 'param-value':
		  baseName = self.appendParamValues(req, baseName, suffixKey);
			break;
		case 'header-value':
		  baseName = self.appendHeaderValues(req, baseName, suffixKey);
			break;
		case 'cookie-value':
		  baseName = self.appendCookieValues(req, baseName, suffixKey);
			break;
		case 'method':
		  baseName = self.appendMethod(req, baseName);
			break;
	}

	return baseName;
}



TransactionNaming.prototype.createWithUriSegments = function(req, baseName, suffixKey) {
  var self = this;

  var segmentLength = self.namingProps['segment-length'];
  var uriLength = self.namingProps['uri-length'] || 'first-n-segments';

  var parts = require('url').parse(req.url || '/');
  var segments = parts.pathname.split('/').splice(1);

  // make sure last slash doesn't cause another empty segment
  if(segments.length > 1 && segments[segments.length - 1] === "") {
    segments.pop();
  }

  var name = "";
  segmentLength = segmentLength ? Math.min(segmentLength, segments.length) : segments.length;
  if(uriLength === 'first-n-segments') {
    for(var i = 0; i < segmentLength; i++) {
      name += "/" + segments[i];
    }
  }
  else if(uriLength === 'last-n-segments') {
    for(var i = segments.length - segmentLength; i < segments.length; i++) {
      name += "/" + segments[i];
    }
  }

  return name;
}



TransactionNaming.prototype.transformUriSegments = function(req, baseName, suffixKey, delimiter) {
	var parts = require('url').parse(req.url || '/');
  var segments = parts.pathname.split('/').splice(1);

  // make sure last slash doesn't cause another empty segment
  if(segments.length > 1 && segments[segments.length - 1] === "") {
    segments.pop();
  }

  var setmentNumberArr = suffixKey.replace(/ /g,'').split(',');
  var setmentNumberMap = {};
  setmentNumberArr.forEach(function(segmentNumberStr) {
  	var segmentNumber = parseInt(segmentNumberStr);
  	if(segmentNumber > 0) {
  		setmentNumberMap[segmentNumber] = true;
  	}
  });

  var newSegments = [];
  for(var i = 0; i < segments.length; i++) {
  	if(setmentNumberMap[i + 1]) {
  		newSegments.push(segments[i]);
  	}
  }

  if(newSegments.length == 0) {
  	return baseName;
  }

  return newSegments.join(delimiter);
}


TransactionNaming.prototype.appendParamValues = function(req, baseName, suffixKey) {
	var paramNames = suffixKey.replace(/ /g,'').split(',');

	// GET params
	var parts = require('url').parse(req.url || '/', true);
	var paramValues = [];
	paramNames.forEach(function(paramName) {
		var paramValue = parts.query[paramName];
		if(paramValue) {
			paramValues.push(paramValue);
		}
	});

	// POST params only available if Express is used
	if(req.body) {
		paramNames.forEach(function(paramName) {
			var paramValue = req.body[paramName];
			if(paramValue) {
				paramValues.push(paramValue);
			}
		});
	}

	if(paramValues.length == 0) {
		return baseName;
	}

	return baseName + '.' + paramValues.join('.');
}


TransactionNaming.prototype.appendHeaderValues = function(req, baseName, suffixKey) {
	var headerNames = suffixKey.replace(/ /g,'').split(',');

	var headerValues = [];
	headerNames.forEach(function(headerName) {
		var headerValue = req.headers[headerName.toLowerCase()];
		if(headerValue) {
			headerValues.push(headerValue);
		}
	});

	if(headerValues.length == 0) {
		return baseName;
	}

	return baseName + '.' + headerValues.join('.');
}


TransactionNaming.prototype.appendCookieValues = function(req, baseName, suffixKey) {
	var cookieNames = suffixKey.replace(/ /g,'').split(',');

	var cookieValues = [];
	var cookieMap = parseCookies(req);
	cookieNames.forEach(function(cookieName) {
		var cookieValue = cookieMap[cookieName];
		if(cookieValue) {
			cookieValues.push(cookieValue);
		}
	});

	if(cookieValues.length == 0) {
		return baseName;
	}

	return baseName + '.' + cookieValues.join('.');
}


TransactionNaming.prototype.appendMethod = function(req, baseName) {
	return baseName + '.' + req.method;
}


function parseCookies(req) {
  var cookieMap = {};
  var cookieHeader = req.headers['cookie'];

  if(cookieHeader) {
    cookieHeader.split(';').forEach(function(cookie) {
       var parts = cookie.split('=');
       if(parts.length == 2 && parts[0] && parts[1]) {
	       cookieMap[trim(parts[0])] = decodeURIComponent(trim(parts[1]));
	     }
    });
  }

  return cookieMap;
}


function trim(str) {
	return str.replace(/^\s+|\s+$/g, '');
}


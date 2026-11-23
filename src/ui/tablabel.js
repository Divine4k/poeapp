'use strict';
// The line under the stash: which tab the framed item is in. The text comes in the address.
document.getElementById('text').textContent = decodeURIComponent(location.hash.slice(1));

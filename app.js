const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

/**
 * Captures all cookies sent in requests during page navigation with expiration times
 * @param {string} url - The URL to navigate to
 * @param {Object} options - Configuration options
 * @param {string} options.outputPath - Path to save cookie data
 * @param {number} options.waitTime - Time to wait after page load (ms)
 * @param {number} options.additionalWait - Additional wait time after clicking (ms)
 */
async function captureCookies(url, options = {}) {
  const defaultOptions = {
    outputPath: path.join(process.cwd(), 'captured-cookies.json'),
    waitTime: 45000, // Wait 25 seconds by default
    additionalWait: 5000 // Additional wait time after clicking the button
  };
  
  const config = { ...defaultOptions, ...options };
  console.log(`Starting cookie capture for: ${url}`);
  
  const browser = await puppeteer.launch({ 
    headless: true,
    defaultViewport: { width: 1280, height: 800 }
  });
  
  try {
    const context = browser.defaultBrowserContext();
    const page = await browser.newPage();
    
    // Store all captured request cookies
    const requestCookies = new Map();
    
    // Enable both request and response interception
    await page.setRequestInterception(true);
    
    // Capture initial browser cookies after navigation
    const capturePageCookies = async () => {
      try {
        // Using CDP (Chrome DevTools Protocol) directly to get cookies
        // Since page.cookies() is deprecated
        const client = await page.createCDPSession();
        const allCookies = await client.send('Network.getAllCookies');
        
        if (allCookies && allCookies.cookies) {
          allCookies.cookies.forEach(cookie => {
            try {
              const url = cookie.domain.startsWith('.') 
                ? `https://${cookie.domain.substring(1)}` 
                : `https://${cookie.domain}`;
              
              const key = `${cookie.domain}|${cookie.name}`;
              const existing = requestCookies.get(key);
              
              // Only add expiration if we don't already have this cookie or if our existing one lacks expiration
              if (!existing || !existing.expires) {
                requestCookies.set(key, {
                  name: cookie.name,
                  value: cookie.value,
                  domain: cookie.domain,
                  path: cookie.path,
                  expires: cookie.expires ? new Date(cookie.expires * 1000).toISOString() : undefined,
                  httpOnly: cookie.httpOnly,
                  secure: cookie.secure,
                  sameSite: cookie.sameSite,
                  url
                });
              }
            } catch (err) {
              console.warn(`Error processing cookie ${cookie.name}:`, err.message);
            }
          });
        }
      } catch (err) {
        console.warn('Error capturing page cookies:', err.message);
      }
    };
    
    // Process cookie headers from requests
    page.on('request', request => {
      const headers = request.headers();
      if (headers.cookie) {
        const url = request.url();
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        const cookieHeader = headers.cookie;
        
        // Parse the cookie string into individual cookies
        const cookies = cookieHeader.split(';').map(cookie => {
          const [name, value] = cookie.trim().split('=');
          return { name, value, domain, url };
        });
        
        // Add cookies to our collection
        for (const cookie of cookies) {
          const key = `${cookie.domain}|${cookie.name}`;
          requestCookies.set(key, cookie);
        }
      }
      request.continue();
    });
    
    // Also monitor response headers for Set-Cookie instructions (which contain expiration)
    page.on('response', async (response) => {
      try {
        const url = response.url();
        const urlObj = new URL(url);
        const domain = urlObj.hostname;
        
        // Get all the Set-Cookie headers (can be multiple)
        const headers = response.headers();
        const setCookieHeaders = headers['set-cookie'];
        
        if (setCookieHeaders) {
          // Split if there are multiple Set-Cookie headers
          const setCookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
          
          for (const setCookie of setCookies) {
            try {
              // Parse the Set-Cookie header
              const cookieParts = setCookie.split(';');
              const mainPart = cookieParts[0].trim();
              const [name, value] = mainPart.split('=');
              
              if (!name) continue;
              
              // Parse cookie attributes
              let expires;
              let maxAge;
              
              for (let i = 1; i < cookieParts.length; i++) {
                const part = cookieParts[i].trim();
                if (part.toLowerCase().startsWith('expires=')) {
                  expires = new Date(part.substring(8)).toISOString();
                } else if (part.toLowerCase().startsWith('max-age=')) {
                  const seconds = parseInt(part.substring(8));
                  if (!isNaN(seconds)) {
                    maxAge = seconds;
                    // Calculate expiration from max-age
                    if (!expires) {
                      const expiryDate = new Date();
                      expiryDate.setSeconds(expiryDate.getSeconds() + seconds);
                      expires = expiryDate.toISOString();
                    }
                  }
                }
              }
              
              // Use the key format consistent with our request cookies
              const key = `${domain}|${name}`;
              const existingCookie = requestCookies.get(key);
              
              // If we already have this cookie, update with expiration info
              if (existingCookie) {
                existingCookie.expires = expires;
                existingCookie.maxAge = maxAge;
                requestCookies.set(key, existingCookie);
              } else {
                // Otherwise add as a new cookie
                requestCookies.set(key, {
                  name,
                  value,
                  domain,
                  url,
                  expires,
                  maxAge
                });
              }
            } catch (err) {
              console.warn(`Error parsing Set-Cookie header: ${setCookie}`, err.message);
            }
          }
        }
      } catch (err) {
        console.warn('Error processing response cookies:', err.message);
      }
    });
    
    // Navigate to the target URL
    console.log(`Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    // Wait for the page to load completely
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Capture initial cookies
    await capturePageCookies();
    
    // Check for and click the banner button
    console.log('Looking for banner button...');
    try {
      // Wait for the button to be visible
      await page.waitForSelector('button.open-support.checker', { timeout: 2000 });
      console.log('Found the banner button, clicking it...');
      
      // Click the button
      await page.click('button.open-support.checker');
      console.log('Clicked the banner button!');
      
      // Wait on the next page for the specified duration
      console.log(`Waiting on the next page for ${config.waitTime / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, config.waitTime));
      
      // Capture cookies after page navigation and wait
      await capturePageCookies();
      
    } catch (err) {
      console.warn('Banner button not found or could not be clicked:', err.message);
      console.log('Continuing with cookie capture...');
    }
    
    // Additional wait time to capture more requests after clicking or if button not found
    console.log(`Waiting additional ${config.additionalWait}ms to capture more requests...`);
    await new Promise(resolve => setTimeout(resolve, config.additionalWait));
    
    // Final cookie capture
    await capturePageCookies();
    
    // Convert Map to Array for output
    const cookiesArray = Array.from(requestCookies.values());
    
    // Generate summary of cookies by domain with expiration
    const cookiesByDomain = {};
    cookiesArray.forEach(cookie => {
      if (!cookiesByDomain[cookie.domain]) {
        cookiesByDomain[cookie.domain] = [];
      }
      cookiesByDomain[cookie.domain].push({
        name: cookie.name,
        value: cookie.value,
        expires: cookie.expires || 'Session cookie (no expiration)',
        path: cookie.path,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite
      });
    });
    
    // Create result object
    const result = {
      url,
      captureDate: new Date().toISOString(),
      totalCookies: cookiesArray.length,
      cookiesByDomain,
      allCookies: cookiesArray
    };
    
    // Save results to file
    fs.writeFileSync(config.outputPath, JSON.stringify(result, null, 2));
    console.log(`Cookie capture complete! Saved to: ${config.outputPath}`);
    console.log(`Total cookies captured: ${cookiesArray.length}`);
    
    return result;
  } catch (error) {
    console.error('Error during cookie capture:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Example usage
// If running this script directly
if (require.main === module) {
  const targetUrl = process.argv[2] || 'https://netfree2.cc/mobile/home?app=1';
  captureCookies(targetUrl)
    .then(result => {
      console.log('Cookie capture completed successfully');
    })
    .catch(error => {
      console.error('Cookie capture failed:', error);
      process.exit(1);
    });
} else {
  // Export for use as a module
  module.exports = { captureCookies };
}
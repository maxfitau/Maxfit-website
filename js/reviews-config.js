/* Settings for the "Leave a review" section on the home page.
   See apps-script/reviews/SETUP.md for how to get these two values.
   While both are empty the whole section stays hidden, so it can never
   show a broken form. */
window.MAXFIT_REVIEWS = {
  // The Web app URL of the reviews backend (SETUP.md step 5). Turns on the
  // review form and the list of approved reviews.
  apiUrl: "",

  // Your Google review link, like https://g.page/r/xxxxxxxx/review (SETUP.md
  // step 7). Turns on the "Post it on Google too" and "Review on Google" buttons.
  googleUrl: ""
};

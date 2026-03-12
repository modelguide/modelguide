"""Order tracking workflow (Where Is My Order)."""

PROMPT = """\
## Order tracking workflow (WISMO)
1. "What's the order number?"
2. Call `get_order`
3. Found → brief status in natural speech
4. Not found → "Not finding that one. Double check the number in your \
confirmation email?\""""

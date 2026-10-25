"""Shared constants for classifier training and the synthetic test pages."""
import re, subprocess, collections

# Classes the classifier knows. Index len(CHARS) is the "junk" class (half letters, two letters, noise).
CHARS = ("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
         ".,!?'\"-:;()/&@#+=%\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df\u20ac")
NCLS = len(CHARS) + 1
JUNK = len(CHARS)

# Families held out of classifier training: they are used for the synthetic test pages.
HELD_OUT = ["Patrick Hand", "Schoolbell", "Gochi Hand", "Shadows Into Light", "Caveat", "Kalam",
            "Dancing Script", "Homemade Apple", "Nanum Pen", "Covered By Your Grace", "Architects Daughter",
            "Handlee"]

HAND_WORDS = re.compile(r"hand|script|marker|brush|sketch|chalk|comic|school|write|scribble|"
                        r"cursive|calli|gochi|caveat|kalam|pacifico|dancing|sue ellen|reenie|rock salt|"
                        r"just me|walter|waiting|zeyada|swanky|over the rainbow|loved by|crafty|nothing you|"
                        r"cedarville|mansalva|sriracha|itim|mali|gaegu|yomogi|klee|playpen|bradley|annie|"
                        r"coming soon|indie flower|neucha|amatic|short stack|delius|schoolbell|fuzzy|sedgwick|"
                        r"gloria|ruthie|satisfy|sacramento|yellowtail|cookie|courgette|damion|^mr |^mrs |la belle|"
                        r"allura|arizonia|alex brush|great vibes|parisienne|tangerine|vibur|bilbo|qwigley|"
                        r"rancho|kristi|dekko|handlee|molle|oregano|nanum|shadows|permanent|rouge|petit|"
                        r"covered|mynerve|gaegu|solitreo|square peg|licorice|birthstone|oooh|ballet|babylonica|playwrite", re.I)

def list_fonts():
    out = subprocess.run(["fc-list", ":", "file", "family", "style"], capture_output=True, text=True).stdout
    fonts = []
    for line in out.splitlines():
        m = re.match(r"(.+?): (.+?):style=(.*)$", line)
        if not m: m = re.match(r"(.+?): (.+)$", line); 
        if not m: continue
        path = m.group(1)
        fam = m.group(2).split(",")[0].strip()
        style = m.group(3) if m.lastindex >= 3 else ""
        if not path.lower().endswith((".ttf", ".otf")): continue
        fonts.append((path, fam, style))
    return fonts

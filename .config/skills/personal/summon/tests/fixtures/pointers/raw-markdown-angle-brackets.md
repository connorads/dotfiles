# Notes on comparison

Guard the loop the obvious way:

    if (count<threshold) {
        report();
    }

Everything from that comparison onwards sits inside what a tag stripper takes
for one long tag, so aiming one at plain Markdown eats the whole passage. The
sentence that matters is this: a pointer is only evidence when the fetch and
the parse are both honest.

Note also that x > y holds throughout.

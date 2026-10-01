using System;
using System.Collections;
using System.Collections.Generic;

// An idea owns completion. Linked schedules only cache it for Windows reminders.
internal static class TaskLinks
{
    static Dictionary<string,object> Child(object value,string key)
    {
        var dict=value as Dictionary<string,object>;object item;
        return dict!=null&&dict.TryGetValue(key,out item)?item as Dictionary<string,object>:null;
    }
    internal static Dictionary<string,object> Idea(Store store,string date,string id)
    {
        var edits=Child(Child(store.WidgetState,"privateContent"),"edits");
        var entry=Child(edits,date??"");object raw;
        if(entry==null||!entry.TryGetValue("ideas",out raw))return null;
        foreach(var item in raw as IEnumerable??new object[0]) {
            var idea=item as Dictionary<string,object>;object value;
            if(idea!=null&&idea.TryGetValue("id",out value)&&Convert.ToString(value)==id)return idea;
        }
        return null;
    }
    internal static bool Flag(Dictionary<string,object> idea,string key)
    { object value;return idea!=null&&idea.TryGetValue(key,out value)&&value is bool&&(bool)value; }
    internal static bool IsTask(Dictionary<string,object> idea)
    { object due;return Flag(idea,"done")||Flag(idea,"todo")||idea!=null&&idea.TryGetValue("dueDate",out due)&&!String.IsNullOrEmpty(Convert.ToString(due)); }
    internal static List<string> Apply(Store store)
    {
        var changed=new List<string>();
        foreach(var pair in store.Schedules) {
            var s=pair.Value;
            if(String.IsNullOrEmpty(s.IdeaId))continue;
            var idea=Idea(store,s.IdeaDate,s.IdeaId);
            if(!IsTask(idea)) {s.IdeaId=null;s.IdeaDate=null;continue;}
            bool done=Flag(idea,"done");
            if(s.Done!=done) {s.Done=done;changed.Add(pair.Key);}
        }
        return changed;
    }
    internal static void Validate(Store store,Schedule s)
    {
        if(String.IsNullOrEmpty(s.IdeaId)) {s.IdeaDate=null;return;}
        var idea=Idea(store,s.IdeaDate,s.IdeaId);
        if(!IsTask(idea))throw new ArgumentException("关联想法不存在或不是待办，请先将想法设为待办。");
        if(s.Done!=Flag(idea,"done"))throw new ArgumentException("关联日程的完成状态跟随想法，请修改想法的完成状态。");
    }
}
